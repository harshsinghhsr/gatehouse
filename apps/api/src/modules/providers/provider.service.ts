import { randomUUID } from 'node:crypto';
import type {
  CreateProviderRequest,
  Provider as ProviderDto,
  ProviderTestResult,
  ProviderTypeInfo,
  UpdateProviderRequest,
} from '@gatehouse/shared';
import type { Config } from '../../core/config.js';
import { NotFoundError } from '../../core/errors.js';
import type { LlmGateway } from '../../core/gateway.js';
import type { Logger, SecretStore } from '../../core/ports.js';
import type { UnitOfWork } from '../../core/unit-of-work.js';
import type { AuthContext } from '../auth/authenticator.js';
import type { AuditService } from '../audit/audit.service.js';
import { PROVIDER_CATALOG, adapterFor, selectFields } from './catalog/index.js';
import { describe } from './catalog/provider-adapter.js';
import type { Provider } from './provider.repository.js';
import { secretReference } from '../../infra/secrets/secret-store.js';

/**
 * Provider onboarding. Credentials are verified before anything is written, stored in the
 * secret store, and pushed to the gateway as a reusable credential that every model of this
 * provider references. Postgres only ever sees the reference.
 */
export class ProviderService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly gateway: LlmGateway,
    private readonly secrets: SecretStore,
    private readonly audit: AuditService,
    private readonly logger: Logger,
    private readonly config: Pick<Config, 'deployEnv'>,
  ) {}

  listTypes(): ProviderTypeInfo[] {
    return Object.entries(PROVIDER_CATALOG).map(([type, adapter]) =>
      describe(type as ProviderTypeInfo['type'], adapter),
    );
  }

  async list(organizationId: string): Promise<ProviderDto[]> {
    const providers = await this.uow.repos.providers.listByOrganization(organizationId);
    return providers.map((provider) => toDto(provider, provider.modelCount));
  }

  async get(organizationId: string, id: string): Promise<ProviderDto> {
    const provider = await this.require(organizationId, id);
    const models = await this.uow.repos.models.listByProvider(provider.id);
    return toDto(provider, models.length);
  }

  async create(context: AuthContext, request: CreateProviderRequest): Promise<ProviderDto> {
    const adapter = adapterFor(request.type);
    const credentials = selectFields(adapter.credentialFields, request.credentials, true);
    const config = selectFields(adapter.configFields, request.config);

    // Verified before any state exists, so a bad credential leaves nothing behind.
    await adapter.verify(credentials, config);

    const organization = await this.uow.repos.organizations.findById(context.organizationId);
    if (!organization) throw new NotFoundError('Organization');

    // The id is minted here so the secret can be written under its final reference — there is
    // no window in which a row points at a placeholder.
    const providerId = randomUUID();
    const reference = secretReference(this.config.deployEnv, context.organizationId, providerId);
    const credentialName = `${organization.slug}__${providerId}`;

    await this.secrets.put(reference, credentials);
    try {
      await this.gateway.putCredential(credentialName, adapter.credentialValues(credentials, config), {
        organization: organization.slug,
        provider: request.name,
      });

      const provider = await this.uow.transaction(async (repos) => {
        const created = await repos.providers.create({
          organizationId: context.organizationId,
          name: request.name,
          type: request.type,
          secretRef: reference,
          config,
        });
        const saved = await repos.providers.update(created.id, {
          litellmCredentialName: credentialName,
          lastTestedAt: new Date(),
        });
        await this.audit.record(
          context,
          {
            action: 'PROVIDER_CREATED',
            targetType: 'provider',
            targetId: saved.id,
            metadata: { name: request.name, type: request.type },
          },
          repos,
        );
        return saved;
      });

      return toDto(provider, 0);
    } catch (error) {
      // Compensate: a half-created provider would leave an orphaned credential on the gateway.
      await this.rollback(credentialName, reference);
      throw error;
    }
  }

  async update(context: AuthContext, id: string, request: UpdateProviderRequest): Promise<ProviderDto> {
    const provider = await this.require(context.organizationId, id);
    const adapter = adapterFor(provider.type);

    if (request.credentials || request.config) {
      const credentials = request.credentials
        ? selectFields(adapter.credentialFields, request.credentials, true)
        : await this.secrets.get(provider.secretRef);
      const config = request.config ? selectFields(adapter.configFields, request.config) : provider.config;

      await adapter.verify(credentials, config);
      await this.secrets.put(provider.secretRef, credentials);
      if (provider.litellmCredentialName) {
        await this.gateway.putCredential(
          provider.litellmCredentialName,
          adapter.credentialValues(credentials, config),
        );
      }
    }

    const updated = await this.uow.transaction(async (repos) => {
      const saved = await repos.providers.update(provider.id, {
        ...(request.name === undefined ? {} : { name: request.name }),
        ...(request.status === undefined ? {} : { status: request.status }),
        ...(request.config === undefined ? {} : { config: selectFields(adapter.configFields, request.config) }),
        ...(request.credentials || request.config ? { lastTestedAt: new Date(), lastTestError: null } : {}),
      });
      await this.audit.record(
        context,
        {
          action: 'PROVIDER_UPDATED',
          targetType: 'provider',
          targetId: provider.id,
          metadata: { fields: Object.keys(request) },
        },
        repos,
      );
      return saved;
    });

    const models = await this.uow.repos.models.listByProvider(provider.id);
    return toDto(updated, models.length);
  }

  /** Re-checks the stored credential and records the outcome for the dashboard. */
  async test(organizationId: string, id: string): Promise<ProviderTestResult> {
    const provider = await this.require(organizationId, id);
    const adapter = adapterFor(provider.type);
    const credentials = await this.secrets.get(provider.secretRef);

    try {
      const models = await adapter.verify(credentials, provider.config);
      await this.uow.repos.providers.update(provider.id, { lastTestedAt: new Date(), lastTestError: null });
      return { ok: true, models };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Verification failed';
      await this.uow.repos.providers.update(provider.id, { lastTestedAt: new Date(), lastTestError: message });
      throw error;
    }
  }

  async delete(context: AuthContext, id: string): Promise<void> {
    const provider = await this.require(context.organizationId, id);
    const models = await this.uow.repos.models.listByProvider(provider.id);

    // Gateway first: a deployment left behind would keep serving traffic with no record here.
    for (const model of models) {
      if (model.litellmModelId) await this.gateway.deregisterModel(model.litellmModelId);
    }
    if (provider.litellmCredentialName) {
      await this.gateway.deleteCredential(provider.litellmCredentialName).catch((error: unknown) => {
        this.logger.warn({ error: String(error), providerId: id }, 'could not remove gateway credential');
      });
    }
    await this.secrets.delete(provider.secretRef).catch((error: unknown) => {
      this.logger.warn({ error: String(error), providerId: id }, 'could not remove stored secret');
    });

    await this.uow.transaction(async (repos) => {
      await repos.providers.delete(provider.id);
      await this.audit.record(
        context,
        {
          action: 'PROVIDER_DELETED',
          targetType: 'provider',
          targetId: provider.id,
          metadata: { name: provider.name, models: models.length },
        },
        repos,
      );
    });
  }

  private async require(organizationId: string, id: string): Promise<Provider> {
    const provider = await this.uow.repos.providers.findInOrganization(id, organizationId);
    if (!provider) throw new NotFoundError('Provider');
    return provider;
  }

  private async rollback(credentialName: string, reference: string): Promise<void> {
    await this.gateway.deleteCredential(credentialName).catch(() => undefined);
    await this.secrets.delete(reference).catch(() => undefined);
  }
}

/** Response shape. The credential and its reference are structurally absent, not filtered out. */
function toDto(provider: Provider, modelCount: number): ProviderDto {
  return {
    id: provider.id,
    name: provider.name,
    type: provider.type,
    displayName: adapterFor(provider.type).displayName,
    status: provider.status,
    config: provider.config,
    modelCount,
    lastTestedAt: provider.lastTestedAt?.toISOString() ?? null,
    lastTestError: provider.lastTestError,
  };
}

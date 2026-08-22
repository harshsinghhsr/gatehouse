import type { CreateModelRequest, Model as ModelDto } from '@gatehouse/shared';
import { ConflictError, NotFoundError } from '../../core/errors.js';
import type { LlmGateway } from '../../core/gateway.js';
import type { UnitOfWork } from '../../core/unit-of-work.js';
import type { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/authenticator.js';
import { adapterFor } from '../providers/catalog/index.js';
import type { ProviderModel } from './provider-model.repository.js';

/**
 * The model catalog. A model is registered with the gateway at runtime — no configuration file
 * is written and the gateway is never restarted.
 */
export class ModelService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly gateway: LlmGateway,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<ModelDto[]> {
    const models = await this.uow.repos.models.list();
    return models.map(toDto);
  }

  async create(context: AuthContext, request: CreateModelRequest): Promise<ModelDto> {
    const provider = await this.uow.repos.providers.findById(request.providerId);
    if (!provider) throw new NotFoundError('Provider');
    if (!provider.litellmCredentialName) {
      throw new ConflictError('This provider has no gateway credential yet');
    }

    // Namespaced per provider so two providers can both publish "gpt-5" — an Azure one and a
    // direct-OpenAI one during a migration. Keys carry an alias so developers keep typing "gpt-5".
    const gatewayModelName = `${provider.slug}/${request.publicModelName}`;

    const gatewayModelId = await this.gateway.registerModel(
      gatewayModelName,
      {
        ...adapterFor(provider.type).modelParams(request.providerModelName),
        litellm_credential_name: provider.litellmCredentialName,
      },
      { provider_id: provider.id, provider: provider.slug },
    );

    const model = await this.uow.transaction(async (repos) => {
      const created = await repos.models.create({
        providerId: provider.id,
        publicModelName: request.publicModelName,
        providerModelName: request.providerModelName,
        gatewayModelName,
        litellmModelId: gatewayModelId,
      });
      await this.audit.record(
        context,
        {
          action: 'MODEL_CREATED',
          targetType: 'model',
          targetId: created.id,
          metadata: { publicModelName: request.publicModelName, providerId: provider.id },
        },
        repos,
      );
      return created;
    });

    return toDto(model);
  }

  /** Disabling deregisters the deployment; enabling registers it again under the same name. */
  async setEnabled(context: AuthContext, id: string, enabled: boolean): Promise<ModelDto> {
    const model = await this.require(id);
    if (model.enabled === enabled) return toDto(model);

    let gatewayModelId = model.litellmModelId;
    if (enabled) {
      gatewayModelId = await this.gateway.registerModel(model.gatewayModelName, {
        ...adapterFor(model.provider.type).modelParams(model.providerModelName),
        litellm_credential_name: model.provider.litellmCredentialName,
      });
    } else if (gatewayModelId) {
      await this.gateway.deregisterModel(gatewayModelId);
      gatewayModelId = null;
    }

    const updated = await this.uow.transaction(async (repos) => {
      const saved = await repos.models.update(id, { enabled, litellmModelId: gatewayModelId });
      await this.audit.record(
        context,
        {
          action: enabled ? 'MODEL_ENABLED' : 'MODEL_DISABLED',
          targetType: 'model',
          targetId: id,
          metadata: { publicModelName: model.publicModelName },
        },
        repos,
      );
      return saved;
    });

    return toDto(updated);
  }

  async delete(context: AuthContext, id: string): Promise<void> {
    const model = await this.require(id);
    if (model.litellmModelId) await this.gateway.deregisterModel(model.litellmModelId);

    await this.uow.transaction(async (repos) => {
      await repos.models.delete(id);
      await this.audit.record(
        context,
        {
          action: 'MODEL_DELETED',
          targetType: 'model',
          targetId: id,
          metadata: { publicModelName: model.publicModelName },
        },
        repos,
      );
    });
  }

  private async require(id: string): Promise<ProviderModel> {
    const model = await this.uow.repos.models.findById(id);
    if (!model) throw new NotFoundError('Model');
    return model;
  }
}

function toDto(model: ProviderModel): ModelDto {
  return {
    id: model.id,
    publicModelName: model.publicModelName,
    providerModelName: model.providerModelName,
    gatewayModelName: model.gatewayModelName,
    enabled: model.enabled,
    provider: { id: model.provider.id, name: model.provider.name, type: model.provider.type },
  };
}

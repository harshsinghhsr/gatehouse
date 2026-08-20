import type { ProviderTypeInfo } from '@gatehouse/shared';

/**
 * What the control plane needs to know about a provider. Adapters describe configuration and
 * verify credentials; they never speak the LLM protocol — that is the gateway's job.
 */
export interface ProviderAdapter {
  readonly displayName: string;
  /** Field names whose values go to the secret store and never appear in a response. */
  readonly credentialFields: ReadonlyArray<{ name: string; label: string }>;
  readonly configFields: ReadonlyArray<{
    name: string;
    label: string;
    required: boolean;
    placeholder: string | null;
  }>;
  /** Hostnames a base URL may resolve to. Anything else is refused before a request is made. */
  readonly allowedHostSuffixes: readonly string[];
  readonly defaultApiBase?: string;

  /** Values stored once on the gateway and referenced by every model of this provider. */
  credentialValues(
    credentials: Record<string, string>,
    config: Record<string, string>,
  ): Record<string, string>;

  /** Gateway parameters for one model, minus the credential reference. */
  modelParams(providerModelName: string): Record<string, unknown>;

  /** Server-side credential check. Returns the model ids the provider reports. */
  verify(credentials: Record<string, string>, config: Record<string, string>): Promise<string[]>;
}

export function describe(type: ProviderTypeInfo['type'], adapter: ProviderAdapter): ProviderTypeInfo {
  return {
    type,
    displayName: adapter.displayName,
    credentialFields: [...adapter.credentialFields],
    configFields: [...adapter.configFields],
  };
}

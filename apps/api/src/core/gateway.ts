/**
 * The gateway port. Services speak this language; only src/infra/litellm knows the vendor
 * on the other side, which is what keeps a LiteLLM upgrade from reaching business logic.
 */

export type KeySpec = {
  alias: string;
  gatewayUserId?: string | undefined;
  gatewayTeamId?: string | undefined;
  /** Model names this key may call. */
  models: string[];
  /** Public name -> gateway name, so a developer types "gpt-5" and not "acme/gpt-5". */
  aliases: Record<string, string>;
  maxBudget?: number | undefined;
  /** Duration string the gateway understands, e.g. "30d". */
  budgetDuration?: string | undefined;
  rpmLimit?: number | undefined;
  tpmLimit?: number | undefined;
};

export type IssuedGatewayKey = {
  /** Plaintext. Travels to the administrator once and is never persisted. */
  secret: string;
  keyId: string;
  expiresAt: Date | null;
};

export type KeyUsage = { spend: number; maxBudget: number | null };

export type UsageBucket = { spend: number; requests: number };

export type UsageReport = {
  totalSpend: number;
  totalRequests: number;
  inputTokens: number;
  outputTokens: number;
  daily: Array<{ date: string; spend: number; requests: number }>;
  byModel: Record<string, UsageBucket>;
  byProvider: Record<string, UsageBucket>;
};

export interface LlmGateway {
  issueKey(spec: KeySpec): Promise<IssuedGatewayKey>;
  updateKey(keyId: string, spec: KeySpec): Promise<void>;
  revokeKeyByAlias(alias: string): Promise<void>;
  readKeyUsage(keyId: string): Promise<KeyUsage | null>;

  createOrganization(name: string): Promise<string>;
  createUser(email: string, organizationId?: string): Promise<string>;
  createTeam(name: string, organizationId?: string): Promise<string>;
  addTeamMember(teamId: string, userId: string): Promise<void>;

  putCredential(name: string, values: Record<string, string>, info?: Record<string, unknown>): Promise<void>;
  deleteCredential(name: string): Promise<void>;

  registerModel(name: string, params: Record<string, unknown>, info?: Record<string, unknown>): Promise<string>;
  deregisterModel(modelId: string): Promise<void>;

  organizationUsage(organizationId: string, from: string, to: string): Promise<UsageReport>;
  userUsage(userId: string, from: string, to: string): Promise<UsageReport>;

  health(): Promise<void>;
}

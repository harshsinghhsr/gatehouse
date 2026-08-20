/**
 * The slice of LiteLLM's wire format this adapter depends on, transcribed from
 * litellm/openapi.v1.97.0.json. Only litellm-gateway.ts may import these — everywhere else
 * uses the vendor-neutral types in core/gateway.ts.
 */

export type GenerateKeyResponse = {
  key: string;
  /** Hashed token; the stable identifier for a key. */
  token_id?: string;
  token?: string;
  key_name?: string;
  expires?: string;
};

export type KeyInfoResponse = {
  info?: {
    spend?: number;
    max_budget?: number | null;
    expires?: string | null;
  };
};

export type NewOrganizationResponse = { organization_id: string };
export type NewUserResponse = { user_id: string };
export type NewTeamResponse = { team_id: string };
export type NewModelResponse = { model_info?: { id?: string } };

export type ActivityMetrics = {
  spend?: number;
  api_requests?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
};

export type DailyActivityResponse = {
  results?: Array<{
    date: string;
    metrics?: ActivityMetrics;
    breakdown?: {
      models?: Record<string, { metrics?: ActivityMetrics }>;
      providers?: Record<string, { metrics?: ActivityMetrics }>;
    };
  }>;
  metadata?: {
    total_spend?: number;
    total_api_requests?: number;
  };
};

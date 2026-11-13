export interface Env {
  SESSIONS: KVNamespace;
  APP_NAME: string;
  APP_URL: string;
  BUFFER_CLIENT_ID: string;
  BUFFER_CLIENT_SECRET: string;
  // 32 random bytes, base64. Encrypts Buffer tokens and the draft at rest in KV.
  TOKEN_KEY: string;
  // One of these turns on the suggestion step. MindStudio is tried first.
  MINDSTUDIO_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  // Optional model overrides.
  MINDSTUDIO_MODEL?: string; // default "claude-5-5-sonnet"
  ANTHROPIC_MODEL?: string; // default "claude-sonnet-5-5"
  // App-wide model calls a day before suggestions pause for everyone. Default 400.
  DAILY_MODEL_CALLS?: string;
}

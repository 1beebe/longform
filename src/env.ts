export interface Env {
  SESSIONS: KVNamespace;
  APP_NAME: string;
  APP_URL: string;
  BUFFER_CLIENT_ID: string;
  BUFFER_CLIENT_SECRET: string;
  // 32 random bytes, base64. Encrypts Buffer tokens and the draft at rest in KV.
  TOKEN_KEY: string;
  // Google sign-in and file picker. All four turn it on; without them the
  // app reads a doc from an "anyone with the link" share link instead.
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string; // secret
  GOOGLE_PICKER_KEY?: string; // browser API key, restricted to this site and the Picker API
  GOOGLE_APP_ID?: string; // the Cloud project number
  // One of these turns on the suggestion step. MindStudio is tried first.
  MINDSTUDIO_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  // Optional model overrides.
  MINDSTUDIO_MODEL?: string; // default "claude-5-5-sonnet"
  ANTHROPIC_MODEL?: string; // default "claude-sonnet-5-5"
  // App-wide model calls a day before suggestions pause for everyone. Default 400.
  DAILY_MODEL_CALLS?: string;
}

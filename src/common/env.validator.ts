export function validateEnvironment(env: NodeJS.ProcessEnv): void {
  const required: string[] = [
    'FRONTEND_ORIGIN',
    'TURSO_DATABASE_URL',
    'FIREBASE_SERVICE_ACCOUNT_JSON',
  ];

  const missing = required.filter((key) => {
    const value = env[key];
    return value === undefined || value === null || value.trim() === '';
  });

  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`);
    console.error('Copy .env.example to .env and fill in every value before starting');
    process.exit(1);
  }

  const geminiKeys = (env.GEMINI_API_KEYS ?? '')
    .split(',')
    .map((key) => key.trim())
    .filter((key) => key.length > 0);
  const singleGeminiKey = (env.GEMINI_API_KEY ?? '').trim();
  if (geminiKeys.length === 0 && singleGeminiKey.length === 0) {
    console.error('GEMINI_API_KEYS (up to 10 keys, comma-separated) or GEMINI_API_KEY is required');
    process.exit(1);
  }

  try {
    JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON as string);
  } catch {
    console.error('FIREBASE_SERVICE_ACCOUNT_JSON must be a valid JSON service account string');
    process.exit(1);
  }
}

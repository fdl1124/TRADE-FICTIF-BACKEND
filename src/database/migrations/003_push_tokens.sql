CREATE TABLE IF NOT EXISTS push_tokens (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL DEFAULT 'web',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_tokens_account ON push_tokens(account_id);

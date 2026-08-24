CREATE TABLE IF NOT EXISTS ai_agents (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  profile TEXT NOT NULL DEFAULT 'custom',
  instructions TEXT,
  thinking_level TEXT NOT NULL DEFAULT 'medium',
  watched_symbols TEXT NOT NULL DEFAULT '[]',
  max_position_size_percent REAL NOT NULL DEFAULT 2,
  daily_loss_limit_percent REAL NOT NULL DEFAULT 3,
  enabled INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'propose',
  circuit_breaker_active INTEGER NOT NULL DEFAULT 0,
  circuit_breaker_reason TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_agents_account ON ai_agents(account_id);

INSERT INTO ai_agents (id, account_id, name, profile, instructions, thinking_level, watched_symbols, max_position_size_percent, daily_loss_limit_percent, enabled, mode, circuit_breaker_active, created_at)
SELECT
  lower(hex(randomblob(16))),
  c.account_id,
  'Analyse Technique',
  'technical',
  NULL,
  'medium',
  COALESCE(c.watched_symbols, '[]'),
  c.max_position_size_percent,
  c.daily_loss_limit_percent,
  c.enabled,
  c.mode,
  c.circuit_breaker_active
FROM ai_agent_configs c
WHERE NOT EXISTS (SELECT 1 FROM ai_agents a WHERE a.account_id = c.account_id AND a.profile = 'technical');

INSERT INTO ai_agents (id, account_id, name, profile, instructions, thinking_level, watched_symbols, max_position_size_percent, daily_loss_limit_percent, enabled, mode, circuit_breaker_active, created_at)
SELECT
  lower(hex(randomblob(16))),
  c.account_id,
  'Sentiment & Actualites',
  'news',
  NULL,
  'low',
  COALESCE(c.watched_symbols, '[]'),
  c.max_position_size_percent,
  c.daily_loss_limit_percent,
  0,
  'propose',
  0
FROM ai_agent_configs c
WHERE NOT EXISTS (SELECT 1 FROM ai_agents a WHERE a.account_id = c.account_id AND a.profile = 'news');

INSERT INTO ai_agents (id, account_id, name, profile, instructions, thinking_level, watched_symbols, max_position_size_percent, daily_loss_limit_percent, enabled, mode, circuit_breaker_active, created_at)
SELECT
  lower(hex(randomblob(16))),
  c.account_id,
  'Risque & Portefeuille',
  'risk',
  NULL,
  'high',
  '["BTCUSDT","ETHUSDT"]',
  c.max_position_size_percent,
  c.daily_loss_limit_percent,
  0,
  'propose',
  0
FROM ai_agent_configs c
WHERE NOT EXISTS (SELECT 1 FROM ai_agents a WHERE a.account_id = c.account_id AND a.profile = 'risk');

CREATE TABLE IF NOT EXISTS chat_conversations (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'Nouvelle conversation',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_conversations_account ON chat_conversations(account_id, updated_at);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  attachments TEXT,
  tool_steps TEXT,
  thinking TEXT,
  sources TEXT,
  order_proposal TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages(conversation_id, created_at);

ALTER TABLE ai_decisions ADD COLUMN agent_id TEXT;
ALTER TABLE ai_decisions ADD COLUMN agent_name TEXT;

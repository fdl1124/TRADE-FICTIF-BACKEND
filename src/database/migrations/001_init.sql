CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  balance REAL NOT NULL DEFAULT 10000,
  starting_balance REAL NOT NULL DEFAULT 10000,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);

CREATE TABLE IF NOT EXISTS positions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  quantity REAL NOT NULL,
  avg_entry_price REAL NOT NULL,
  stop_loss REAL,
  take_profit REAL,
  leverage REAL NOT NULL DEFAULT 1,
  opened_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_positions_account ON positions(account_id);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  type TEXT NOT NULL,
  side TEXT NOT NULL,
  quantity REAL NOT NULL,
  limit_price REAL,
  requested_price REAL NOT NULL,
  filled_price REAL,
  slippage REAL,
  status TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  stop_loss REAL,
  take_profit REAL,
  rejection_reason TEXT,
  created_at TEXT NOT NULL,
  filled_at TEXT,
  realized_pnl REAL,
  reached_at TEXT,
  fill_after TEXT
);

CREATE INDEX IF NOT EXISTS idx_orders_account_status ON orders(account_id, status);

CREATE TABLE IF NOT EXISTS ai_decisions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  action TEXT NOT NULL,
  confidence_score REAL NOT NULL,
  proposed_quantity REAL,
  proposed_stop_loss REAL,
  proposed_take_profit REAL,
  full_reasoning TEXT NOT NULL,
  reasoning_summary TEXT NOT NULL,
  key_factors TEXT NOT NULL,
  validation_passed INTEGER NOT NULL,
  validation_errors TEXT NOT NULL,
  resulting_order_id TEXT,
  model_used TEXT NOT NULL,
  thinking_level TEXT NOT NULL,
  context_json TEXT NOT NULL,
  raw_response TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_decisions_account ON ai_decisions(account_id, created_at);

CREATE TABLE IF NOT EXISTS ai_decision_outcomes (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  outcome TEXT NOT NULL,
  order_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_outcomes_decision ON ai_decision_outcomes(decision_id);

CREATE TABLE IF NOT EXISTS ai_agent_configs (
  account_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'propose',
  watched_symbols TEXT NOT NULL DEFAULT '[]',
  max_position_size_percent REAL NOT NULL DEFAULT 2,
  daily_loss_limit_percent REAL NOT NULL DEFAULT 3,
  circuit_breaker_active INTEGER NOT NULL DEFAULT 0,
  circuit_breaker_reason TEXT
);

CREATE TABLE IF NOT EXISTS price_history (
  symbol TEXT NOT NULL,
  price REAL NOT NULL,
  change_24h REAL NOT NULL,
  ts TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_price_history_symbol ON price_history(symbol, ts);

CREATE TABLE IF NOT EXISTS applied_migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

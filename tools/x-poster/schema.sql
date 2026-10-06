-- Accounts this app may post to, with their X tokens sealed by SECRET_KEY.
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  x_user_id TEXT NOT NULL UNIQUE,
  handle TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  access_sealed TEXT NOT NULL,
  refresh_sealed TEXT NOT NULL DEFAULT '',
  expires_at INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ok',
  created_at INTEGER NOT NULL
);

-- Every post, from either the web screen or Telegram.
-- status: pending (waiting for a Telegram yes) / scheduled / posting / posted / failed / canceled
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  text TEXT NOT NULL,
  text_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  scheduled_at INTEGER NOT NULL,
  posted_at INTEGER,
  tweet_id TEXT,
  error TEXT,
  source TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS posts_due ON posts (status, scheduled_at);
CREATE INDEX IF NOT EXISTS posts_hash ON posts (text_hash);

-- One-time OAuth sign-in attempts (state + PKCE verifier), short-lived.
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  verifier TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

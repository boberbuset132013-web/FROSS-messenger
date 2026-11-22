ALTER TABLE users ADD COLUMN display_name TEXT;
ALTER TABLE users ADD COLUMN bio TEXT;
ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN avatar TEXT;
ALTER TABLE users ADD COLUMN settings TEXT;
ALTER TABLE users ADD COLUMN last_seen INTEGER;
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('dm','group')),
  title TEXT,
  owner_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_members (
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY(chat_id, user_id)
);
CREATE INDEX IF NOT EXISTS chat_members_user_idx ON chat_members(user_id);

-- Baseline the migration that was originally run manually in D1 Console,
-- then mark this upgrade after the statements above have succeeded.
CREATE TABLE IF NOT EXISTS "d1_migrations" (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
INSERT OR IGNORE INTO "d1_migrations" (name) VALUES ('0001_init.sql');
INSERT OR IGNORE INTO "d1_migrations" (name) VALUES ('0002_profiles_chats.sql');

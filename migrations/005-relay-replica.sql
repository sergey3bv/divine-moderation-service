-- Mirror authoritative relay/API data into D1 so admin lookup can use local
-- replicated video and creator context without relying on skinny moderation
-- rows. api.divine.video remains the source of truth; these tables are a
-- replicated cache/fallback for admin.

CREATE TABLE IF NOT EXISTS relay_videos (
  sha256 TEXT PRIMARY KEY,
  event_id TEXT,
  stable_id TEXT,
  pubkey TEXT,
  title TEXT,
  content TEXT,
  summary TEXT,
  video_url TEXT,
  thumbnail_url TEXT,
  published_at TEXT,
  created_at TEXT,
  author_name TEXT,
  author_avatar TEXT,
  raw_json TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  source_updated_at TEXT
);

CREATE INDEX IF NOT EXISTS relay_videos_event_id_idx ON relay_videos (event_id);
CREATE INDEX IF NOT EXISTS relay_videos_stable_id_idx ON relay_videos (stable_id);
CREATE INDEX IF NOT EXISTS relay_videos_pubkey_idx ON relay_videos (pubkey);
CREATE INDEX IF NOT EXISTS relay_videos_synced_at_idx ON relay_videos (synced_at);

CREATE TABLE IF NOT EXISTS relay_creators (
  pubkey TEXT PRIMARY KEY,
  display_name TEXT,
  username TEXT,
  avatar_url TEXT,
  bio TEXT,
  website TEXT,
  nip05 TEXT,
  follower_count INTEGER,
  following_count INTEGER,
  video_count INTEGER,
  event_count INTEGER,
  first_activity TEXT,
  last_activity TEXT,
  raw_json TEXT NOT NULL,
  synced_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS relay_creators_username_idx ON relay_creators (username);
CREATE INDEX IF NOT EXISTS relay_creators_synced_at_idx ON relay_creators (synced_at);

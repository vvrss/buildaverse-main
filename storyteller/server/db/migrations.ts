/**
 * Schema versions, applied in order and tracked with PRAGMA user_version.
 * Times are integer milliseconds. Public ids are random base62 strings.
 */
export const MIGRATIONS: string[] = [
  // 1: accounts, pictures, stories, chapters, episodes, social, moderation.
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    color TEXT NOT NULL,
    bio TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'moderator', 'admin')),
    banned_at INTEGER,
    created_at INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE blobs (
    id TEXT PRIMARY KEY,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    widths TEXT NOT NULL,
    avif INTEGER NOT NULL DEFAULT 0,
    bytes INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE uploads (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ref TEXT NOT NULL,
    blob_id TEXT NOT NULL REFERENCES blobs(id),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, ref)
  ) STRICT, WITHOUT ROWID;
  CREATE INDEX uploads_blob ON uploads(blob_id);

  CREATE TABLE stories (
    id TEXT PRIMARY KEY,
    author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_key TEXT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    genre TEXT NOT NULL DEFAULT '',
    cover_ref TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_published_at INTEGER,
    hidden_at INTEGER,
    UNIQUE (author_id, client_key)
  ) STRICT;
  CREATE INDEX stories_author ON stories(author_id, updated_at DESC);
  CREATE INDEX stories_recent ON stories(last_published_at DESC, id DESC) WHERE last_published_at IS NOT NULL;
  CREATE INDEX stories_genre ON stories(genre, last_published_at DESC);

  CREATE TABLE story_tags (
    story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    PRIMARY KEY (story_id, tag)
  ) STRICT, WITHOUT ROWID;
  CREATE INDEX story_tags_tag ON story_tags(tag);

  CREATE TABLE chapters (
    id TEXT PRIMARY KEY,
    story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    client_key TEXT,
    position INTEGER NOT NULL,
    title TEXT NOT NULL,
    cover_ref TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE (story_id, client_key)
  ) STRICT;
  CREATE INDEX chapters_story ON chapters(story_id, position);

  CREATE TABLE episodes (
    id TEXT PRIMARY KEY,
    story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    client_key TEXT NOT NULL,
    position INTEGER NOT NULL,
    title TEXT NOT NULL,
    cover_ref TEXT,
    body TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    words INTEGER NOT NULL,
    published_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    hidden_at INTEGER,
    UNIQUE (story_id, client_key)
  ) STRICT;
  CREATE INDEX episodes_chapter ON episodes(chapter_id, position);
  CREATE INDEX episodes_story ON episodes(story_id);
  CREATE INDEX episodes_recent ON episodes(published_at DESC, id DESC);

  CREATE TABLE episode_media (
    episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
    ref TEXT NOT NULL,
    blob_id TEXT NOT NULL REFERENCES blobs(id),
    PRIMARY KEY (episode_id, ref)
  ) STRICT, WITHOUT ROWID;
  CREATE INDEX episode_media_blob ON episode_media(blob_id);

  CREATE TABLE comments (
    id INTEGER PRIMARY KEY,
    episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
    author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    edited_at INTEGER,
    deleted_at INTEGER,
    hidden_at INTEGER
  ) STRICT;
  CREATE INDEX comments_top ON comments(episode_id, id DESC) WHERE parent_id IS NULL;
  CREATE INDEX comments_replies ON comments(parent_id, id);

  CREATE TABLE comment_likes (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (comment_id, user_id)
  ) STRICT, WITHOUT ROWID;

  CREATE TABLE episode_likes (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (episode_id, user_id)
  ) STRICT, WITHOUT ROWID;
  CREATE INDEX likes_user ON episode_likes(user_id);

  CREATE TABLE story_follows (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, story_id)
  ) STRICT, WITHOUT ROWID;
  CREATE INDEX story_follows_story ON story_follows(story_id);

  CREATE TABLE user_follows (
    follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    followee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (follower_id, followee_id),
    CHECK (follower_id <> followee_id)
  ) STRICT, WITHOUT ROWID;
  CREATE INDEX user_follows_followee ON user_follows(followee_id);

  CREATE TABLE reading_progress (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, story_id)
  ) STRICT, WITHOUT ROWID;
  CREATE INDEX reading_progress_recent ON reading_progress(user_id, updated_at DESC);

  CREATE TABLE notifications (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('episode', 'comment', 'reply', 'like', 'follow')),
    actor_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    story_id TEXT REFERENCES stories(id) ON DELETE CASCADE,
    episode_id TEXT REFERENCES episodes(id) ON DELETE CASCADE,
    comment_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    read_at INTEGER
  ) STRICT;
  CREATE INDEX notifications_user ON notifications(user_id, id DESC);

  CREATE TABLE reports (
    id INTEGER PRIMARY KEY,
    reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    target_kind TEXT NOT NULL CHECK (target_kind IN ('story', 'episode', 'comment', 'user')),
    target_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    resolved_at INTEGER,
    resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    resolution TEXT
  ) STRICT;
  CREATE INDEX reports_open ON reports(resolved_at, id DESC);
  CREATE UNIQUE INDEX reports_once ON reports(reporter_id, target_kind, target_id) WHERE resolved_at IS NULL;

  CREATE TABLE mod_log (
    id INTEGER PRIMARY KEY,
    moderator_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    target_kind TEXT NOT NULL,
    target_id TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX mod_log_recent ON mod_log(id DESC);
  `,
];

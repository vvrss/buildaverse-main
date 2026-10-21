import type { Deps } from './context';
import type { NotificationKind } from '../src/shared/api';

/** Writes a notification, never to the actor themselves. */
export function notify(
  deps: Deps,
  userId: number,
  kind: NotificationKind,
  fields: { actorId?: number | null; storyId?: string | null; episodeId?: string | null; commentId?: number | null },
) {
  if (fields.actorId && fields.actorId === userId) return;
  deps.db.run(
    `INSERT INTO notifications (user_id, kind, actor_id, story_id, episode_id, comment_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    userId,
    kind,
    fields.actorId ?? null,
    fields.storyId ?? null,
    fields.episodeId ?? null,
    fields.commentId ?? null,
    deps.clock.now(),
  );
}

/** A new episode: everyone following the story or its author hears about it once. */
export function notifyNewEpisode(deps: Deps, authorId: number, storyId: string, episodeId: string) {
  const readers = deps.db.all<{ user_id: number }>(
    `SELECT user_id FROM story_follows WHERE story_id = ?
     UNION SELECT follower_id AS user_id FROM user_follows WHERE followee_id = ?
     LIMIT 5000`,
    storyId,
    authorId,
  );
  for (const r of readers) notify(deps, r.user_id, 'episode', { actorId: authorId, storyId, episodeId });
}

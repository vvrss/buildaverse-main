import type { Deps } from '../context';

const KEEP_UNUSED_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Removes pictures nothing uses any more:
 *  1. upload records older than a week that no published episode, story
 *     cover or chapter cover of that author refers to;
 *  2. stored pictures with no upload record and no episode using them.
 * Files go first, then the row, so a crash leaves at worst a row to retry.
 */
export function collectGarbage(deps: Deps): { uploads: number; blobs: number } {
  const { db, media, clock } = deps;
  const cutoff = clock.now() - KEEP_UNUSED_MS;
  const uploads = db.run(
    `DELETE FROM uploads
      WHERE created_at < ?
        AND NOT EXISTS (
          SELECT 1 FROM episode_media em JOIN episodes e ON e.id = em.episode_id JOIN stories s ON s.id = e.story_id
           WHERE s.author_id = uploads.user_id AND em.ref = uploads.ref)
        AND NOT EXISTS (SELECT 1 FROM stories s WHERE s.author_id = uploads.user_id AND s.cover_ref = uploads.ref)
        AND NOT EXISTS (
          SELECT 1 FROM chapters c JOIN stories s ON s.id = c.story_id
           WHERE s.author_id = uploads.user_id AND c.cover_ref = uploads.ref)`,
    cutoff,
  ).changes;

  const orphans = db.all<{ id: string }>(
    `SELECT id FROM blobs b
      WHERE NOT EXISTS (SELECT 1 FROM uploads u WHERE u.blob_id = b.id)
        AND NOT EXISTS (SELECT 1 FROM episode_media em WHERE em.blob_id = b.id)`,
  );
  for (const { id } of orphans) {
    media.remove(id);
    db.run('DELETE FROM blobs WHERE id = ?', id);
  }
  return { uploads, blobs: orphans.length };
}

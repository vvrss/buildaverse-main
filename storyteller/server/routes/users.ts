import { Hono } from 'hono';
import type { AuthorProfile, StoryCard, UserSummary } from '../../src/shared/api';
import { isModerator, requireUser } from '../auth/sessions';
import type { AppEnv, UserRow } from '../context';
import { notFound } from '../http/errors';
import { type StoryRow, PUBLIC_STORY, STORY_WITH_AUTHOR, storyCards, summary } from '../queries';

export function userRoutes() {
  const app = new Hono<AppEnv>();

  /** A writer's page: who they are and their published stories. */
  app.get('/users/:username', (c) => {
    const { db } = c.var.deps;
    const viewer = c.var.user;
    const target = db.get<UserRow>('SELECT * FROM users WHERE username = ?', c.req.param('username').toLowerCase());
    const self = !!viewer && !!target && viewer.id === target.id;
    const mod = isModerator(viewer);
    // Suspended writers disappear for everyone but themselves and moderators.
    if (!target || (target.banned_at && !self && !mod)) throw notFound('That writer');
    const privileged = self || mod;
    const rows = db.all<StoryRow & { a_username: string; a_display_name: string; a_color: string }>(
      `${STORY_WITH_AUTHOR} WHERE s.author_id = ? AND ${privileged ? 's.last_published_at IS NOT NULL' : PUBLIC_STORY}
        ORDER BY s.last_published_at DESC, s.id DESC LIMIT 100`,
      target.id,
    );
    const counts = db.get<{ followers: number; following: number }>(
      `SELECT (SELECT COUNT(*) FROM user_follows WHERE followee_id = ?) AS followers,
              (SELECT COUNT(*) FROM user_follows WHERE follower_id = ?) AS following`,
      target.id,
      target.id,
    )!;
    const body: AuthorProfile = {
      ...summary(target),
      bio: target.bio,
      createdAt: target.created_at,
      followers: counts.followers,
      following: counts.following,
      stories: storyCards(db, rows),
      viewer: {
        following: !!viewer && !!db.get('SELECT 1 FROM user_follows WHERE follower_id = ? AND followee_id = ?', viewer.id, target.id),
        isSelf: self,
        canModerate: mod && !self && target.role !== 'admin',
      },
      banned: !!target.banned_at,
    };
    return c.json(body);
  });

  /** Everything you follow, for managing the Following tab. */
  app.get('/me/following', (c) => {
    const { db } = c.var.deps;
    const user = requireUser(c);
    const stories = db.all<StoryRow & { a_username: string; a_display_name: string; a_color: string }>(
      `${STORY_WITH_AUTHOR} JOIN story_follows f ON f.story_id = s.id AND f.user_id = ?
        WHERE ${PUBLIC_STORY} ORDER BY f.created_at DESC LIMIT 200`,
      user.id,
    );
    const writers = db.all<UserRow>(
      `SELECT u.* FROM user_follows f JOIN users u ON u.id = f.followee_id
        WHERE f.follower_id = ? AND u.banned_at IS NULL ORDER BY f.created_at DESC LIMIT 200`,
      user.id,
    );
    const body: { stories: StoryCard[]; writers: UserSummary[] } = {
      stories: storyCards(db, stories),
      writers: writers.map(summary),
    };
    return c.json(body);
  });

  return app;
}

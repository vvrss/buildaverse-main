import type { Deps, UserRow } from './context';

/** Records what a moderator did, so actions can be reviewed later. */
export function logAction(deps: Deps, moderator: UserRow, action: string, targetKind: string, targetId: string | number, note = '') {
  deps.db.run(
    'INSERT INTO mod_log (moderator_id, action, target_kind, target_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    moderator.id,
    action,
    targetKind,
    String(targetId),
    note.slice(0, 500),
    deps.clock.now(),
  );
}

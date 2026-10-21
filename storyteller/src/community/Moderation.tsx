import { useState } from 'preact/hooks';
import { Check, EyeOff, ShieldCheck, X } from 'lucide-preact';
import type { ModLogEntry, ModUser, ReportDto } from '../shared/api';
import { showToast } from '../store/storyStore';
import { Avatar, Segmented } from '../ui/controls';
import { ago } from '../views/shared';
import { cPath } from '../router';
import { errorText, me, post, put } from './api';
import { usePaged } from './CommunityHome';
import { CommunityPage } from './StoryPage';
import { Empty, ErrorBox, useApi } from './ui';

const REASON: Record<string, string> = {
  spam: 'Spam',
  harassment: 'Harassment',
  hate: 'Hate',
  sexual: 'Sexual content',
  violence: 'Violence',
  copyright: 'Copyright',
  other: 'Other',
};

function Reports() {
  const list = usePaged<ReportDto>('/mod/reports');
  const resolve = async (r: ReportDto, resolution: 'dismissed' | 'actioned', hide = false) => {
    try {
      if (hide && r.targetKind !== 'user') {
        const path = { story: 'stories', episode: 'episodes', comment: 'comments' }[r.targetKind];
        await put(`/mod/${path}/${r.targetId}/hidden`, { note: `Report: ${REASON[r.reason]}` });
      }
      if (hide && r.targetKind === 'user') await put(`/mod/users/${r.targetId}/ban`, { note: `Report: ${REASON[r.reason]}` });
      await post('/mod/reports/resolve', { targetKind: r.targetKind, targetId: r.targetId, resolution });
      showToast(resolution === 'dismissed' ? 'Report dismissed' : 'Done');
      list.reload();
    } catch (err) {
      showToast(errorText(err));
    }
  };
  if (list.error) return <ErrorBox error={list.error} retry={list.reload} />;
  if (!list.loading && list.items.length === 0) return <Empty icon={<ShieldCheck size={26} />} title="No open reports" />;
  return (
    <ul class="mod-list">
      {list.items.map((r) => (
        <li key={r.id} class="mod-item">
          <div>
            <b>{REASON[r.reason] ?? r.reason}</b>
            <span class="muted small">
              {' '}
              · {r.count > 1 ? `${r.count} reports` : `by ${r.reporter?.displayName ?? 'someone'}`} · {ago(r.createdAt)}
            </span>
          </div>
          <p>{r.targetLink ? <a href={r.targetLink}>{r.targetLabel}</a> : r.targetLabel}</p>
          {r.details && <p class="muted small">“{r.details}”</p>}
          <div class="row-actions">
            <button type="button" class="btn small" onClick={() => resolve(r, 'actioned', true)}>
              <EyeOff size={15} /> {r.targetKind === 'user' ? 'Suspend' : 'Hide'}
            </button>
            <button type="button" class="btn small" onClick={() => resolve(r, 'actioned')}>
              <Check size={15} /> Handled
            </button>
            <button type="button" class="btn small" onClick={() => resolve(r, 'dismissed')}>
              <X size={15} /> Dismiss
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Writers() {
  const [q, setQ] = useState('');
  const { data, error, reload } = useApi<{ items: ModUser[] }>(`/mod/users?q=${encodeURIComponent(q)}`, [q]);
  return (
    <>
      <input class="field" type="search" placeholder="Find a writer" value={q} onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)} />
      {error ? <ErrorBox error={error} retry={reload} /> : null}
      <ul class="feed">
        {(data?.items ?? []).map((u) => (
          <li key={u.username}>
            <a class="feed-item" href={`#${cPath.user(u.username)}`}>
              <Avatar name={u.displayName} color={u.color} size={32} />
              <span class="feed-text">
                <b>
                  {u.displayName} <span class="muted">@{u.username}</span>
                </b>
                <span class="muted small">
                  {u.role !== 'user' && `${u.role} · `}
                  {u.banned && 'suspended · '}
                  {u.stories} stories · {u.comments} comments · joined {new Date(u.createdAt).toLocaleDateString()}
                </span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}

/** "hid", "suspended", "dismissed the reports on"… for a log line. */
const ACTIONS: Record<string, string> = {
  hide: 'hid',
  unhide: 'made visible again',
  ban: 'suspended',
  unban: 'lifted the suspension of',
  delete: 'deleted',
  'role:moderator': 'made a moderator:',
  'role:user': 'removed the moderator role from',
  'resolve:dismissed': 'dismissed the reports on',
  'resolve:actioned': 'handled the reports on',
};

const TARGETS: Record<string, string> = { story: 'a story', episode: 'an episode', comment: 'a comment', user: '' };

function logTarget(l: ModLogEntry) {
  if (l.targetKind === 'user') return <a href={`#${cPath.user(l.targetId)}`}>@{l.targetId}</a>;
  const link = l.targetKind === 'story' ? cPath.story(l.targetId) : l.targetKind === 'episode' ? cPath.episode(l.targetId) : null;
  const label = TARGETS[l.targetKind] ?? l.targetKind;
  return link && !l.action.startsWith('delete') ? <a href={`#${link}`}>{label}</a> : <span>{label}</span>;
}

function Log() {
  const list = usePaged<ModLogEntry>('/mod/log');
  if (list.error) return <ErrorBox error={list.error} retry={list.reload} />;
  return (
    <>
      <ul class="mod-log">
        {list.items.map((l) => (
          <li key={l.id}>
            <b>{l.moderator?.displayName ?? 'Someone'}</b> {ACTIONS[l.action] ?? l.action} {logTarget(l)}
            {l.note && <span class="muted"> · “{l.note}”</span>} <span class="muted small">· {ago(l.createdAt)}</span>
          </li>
        ))}
      </ul>
      {list.next && (
        <button type="button" class="btn wide" onClick={list.more}>
          Older
        </button>
      )}
    </>
  );
}

export function Moderation() {
  const [tab, setTab] = useState<'reports' | 'writers' | 'log'>('reports');
  const m = me.value;
  if (!m || (m.role !== 'moderator' && m.role !== 'admin')) {
    return (
      <CommunityPage>
        <Empty icon={<ShieldCheck size={26} />} title="For moderators only" />
      </CommunityPage>
    );
  }
  return (
    <CommunityPage>
      <h1 class="display page-title">Moderation</h1>
      <Segmented
        label="Moderation"
        value={tab}
        options={[
          ['reports', 'Reports'],
          ['writers', 'Writers'],
          ['log', 'Log'],
        ]}
        onChange={setTab}
      />
      <div class="c-body">
        {tab === 'reports' && <Reports />}
        {tab === 'writers' && <Writers />}
        {tab === 'log' && <Log />}
      </div>
    </CommunityPage>
  );
}

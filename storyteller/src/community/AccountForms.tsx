import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { AtSign, KeyRound, LogOut, Pencil, Trash2, UserPlus } from 'lucide-preact';
import { currentProfile } from '../store/profile';
import { showToast } from '../store/storyStore';
import { Group, Row } from '../ui/controls';
import { Sheet, closeSheet, confirmAction, showSheet } from '../ui/overlay';
import { changePassword, createAccount, deleteAccount, signIn, signOutAccount, updateAccount } from './account';
import { ApiError, community, errorText, me, registrationOpen } from './api';

/** A username suggestion from a profile name: lowercase letters, digits and _. */
function suggestUsername(name: string) {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 24) || ''
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: ComponentChildren }) {
  return (
    <label class="form-field">
      <span class="form-label">{label}</span>
      {children}
      {error && <span class="form-error">{error}</span>}
    </label>
  );
}

/**
 * Sign in or create a Community account for this profile. Used in a sheet
 * and inline on the publish screen.
 */
export function AccountForms({ onDone, reason }: { onDone?: () => void; reason?: string }) {
  const profile = currentProfile.value;
  const [mode, setMode] = useState<'signin' | 'create'>(registrationOpen.value ? 'create' : 'signin');
  const [username, setUsername] = useState(profile?.account?.username ?? suggestUsername(profile?.name ?? ''));
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState(profile?.name ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setMessage(null);
    try {
      if (mode === 'signin') await signIn(username, password);
      else await createAccount({ username, password, displayName: displayName || username, color: profile?.color ?? '#5b3df5' });
      showToast(mode === 'signin' ? 'Signed in' : 'Account created');
      onDone?.();
    } catch (err) {
      if (err instanceof ApiError && err.data?.fields) setErrors(err.data.fields);
      else setMessage(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class="account-form" onSubmit={submit}>
      {reason && <p class="muted">{reason}</p>}
      <div class="segmented wide" role="tablist" aria-label="Account">
        <button type="button" role="tab" aria-selected={mode === 'create'} class={mode === 'create' ? 'on' : ''} onClick={() => setMode('create')}>
          Create account
        </button>
        <button type="button" role="tab" aria-selected={mode === 'signin'} class={mode === 'signin' ? 'on' : ''} onClick={() => setMode('signin')}>
          Sign in
        </button>
      </div>
      {mode === 'create' && !registrationOpen.value && <p class="form-error">New accounts are not being accepted right now.</p>}
      <Field label="Username" error={errors.username}>
        <span class="prefixed">
          <AtSign size={16} />
          <input
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellcheck={false}
            required
            value={username}
            onInput={(e) => setUsername((e.currentTarget as HTMLInputElement).value)}
            data-testid="account-username"
          />
        </span>
      </Field>
      {mode === 'create' && (
        <Field label="Name shown to readers" error={errors.displayName}>
          <input
            name="displayName"
            maxLength={40}
            value={displayName}
            onInput={(e) => setDisplayName((e.currentTarget as HTMLInputElement).value)}
            data-testid="account-display-name"
          />
        </Field>
      )}
      <Field label="Password" error={errors.password}>
        <input
          type="password"
          name="password"
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          required
          minLength={mode === 'create' ? 8 : undefined}
          value={password}
          onInput={(e) => setPassword((e.currentTarget as HTMLInputElement).value)}
          data-testid="account-password"
        />
      </Field>
      {mode === 'create' && <p class="muted small">At least 8 characters. There's no email, so keep it somewhere safe.</p>}
      {message && <p class="form-error" role="alert">{message}</p>}
      <button type="submit" class="btn primary" disabled={busy} data-testid="account-submit">
        {mode === 'signin' ? 'Sign in' : 'Create account'}
      </button>
    </form>
  );
}

export function AccountSheet({ reason }: { reason?: string }) {
  return (
    <Sheet title="Community account">
      <AccountForms reason={reason} onDone={() => closeSheet()} />
    </Sheet>
  );
}

function PasswordSheet() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet title="Change password">
      <form
        class="account-form"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await changePassword(current, next);
            closeSheet();
            showToast('Password changed. Other devices are signed out.');
          } catch (err) {
            setError(err instanceof ApiError && err.data?.fields ? Object.values(err.data.fields)[0] : errorText(err));
          }
        }}
      >
        <Field label="Current password">
          <input type="password" autoComplete="current-password" required value={current} onInput={(e) => setCurrent((e.currentTarget as HTMLInputElement).value)} />
        </Field>
        <Field label="New password">
          <input type="password" autoComplete="new-password" required minLength={8} value={next} onInput={(e) => setNext((e.currentTarget as HTMLInputElement).value)} />
        </Field>
        {error && <p class="form-error">{error}</p>}
        <button type="submit" class="btn primary">
          Change password
        </button>
      </form>
    </Sheet>
  );
}

function EditAccountSheet() {
  const m = me.value!;
  const [displayName, setDisplayName] = useState(m.displayName);
  const [bio, setBio] = useState(m.bio);
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet title="Your writer page">
      <form
        class="account-form"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await updateAccount({ displayName, bio });
            closeSheet();
            showToast('Saved');
          } catch (err) {
            setError(errorText(err));
          }
        }}
      >
        <Field label="Name shown to readers">
          <input maxLength={40} value={displayName} onInput={(e) => setDisplayName((e.currentTarget as HTMLInputElement).value)} />
        </Field>
        <Field label="About you">
          <textarea rows={4} maxLength={300} value={bio} onInput={(e) => setBio((e.currentTarget as HTMLTextAreaElement).value)} />
        </Field>
        {error && <p class="form-error">{error}</p>}
        <button type="submit" class="btn primary">
          Save
        </button>
      </form>
    </Sheet>
  );
}

function DeleteAccountSheet() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet title="Delete Community account">
      <form
        class="account-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = await confirmAction({
            title: 'Delete your account?',
            message: <p>Your published stories, episodes, comments and likes are removed from the Community. Stories on this device stay.</p>,
            confirmLabel: 'Delete account',
            danger: true,
          });
          if (!ok) return;
          try {
            await deleteAccount(password);
            closeSheet();
            showToast('Account deleted');
          } catch (err) {
            setError(errorText(err));
          }
        }}
      >
        <p class="muted">Enter your password to confirm.</p>
        <Field label="Password">
          <input type="password" autoComplete="current-password" required value={password} onInput={(e) => setPassword((e.currentTarget as HTMLInputElement).value)} />
        </Field>
        {error && <p class="form-error">{error}</p>}
        <button type="submit" class="btn danger-solid">
          Delete account
        </button>
      </form>
    </Sheet>
  );
}

/** The "Community account" group on the Profile page. */
export function AccountSection() {
  const state = community.value;
  if (state === 'unknown' || state === 'checking') {
    return (
      <Group title="Community account">
        <Row label="Checking for a Community…" />
      </Group>
    );
  }
  if (state !== 'ready') {
    return (
      <Group title="Community account" footer="Publishing needs a Storyteller server. Your stories work fully without one.">
        <Row
          label={state === 'outdated' ? 'Update the app to use the Community' : "Community isn't set up here"}
          hint={state === 'outdated' ? 'This version is too old for the server.' : 'This copy of the app has no server to publish to.'}
        />
      </Group>
    );
  }
  const m = me.value;
  if (!m) {
    return (
      <Group title="Community account" footer="Reading is open to everyone. An account lets you publish, comment, like and follow.">
        <Row icon={<UserPlus size={20} />} label="Create an account or sign in" onClick={() => showSheet(<AccountSheet />)} />
      </Group>
    );
  }
  return (
    <Group title="Community account" footer="Signed in on this profile only. Other profiles on this device have their own account.">
      <Row icon={<AtSign size={20} />} label={m.displayName} hint={`@${m.username}${m.role !== 'user' ? ` · ${m.role}` : ''}`} href={`#/c/u/${m.username}`} />
      <Row icon={<Pencil size={20} />} label="Edit your writer page" onClick={() => showSheet(<EditAccountSheet />)} />
      <Row icon={<KeyRound size={20} />} label="Change password" onClick={() => showSheet(<PasswordSheet />)} />
      <Row icon={<LogOut size={20} />} label="Sign out of the Community" onClick={() => void signOutAccount().then(() => showToast('Signed out'))} />
      <Row icon={<Trash2 size={20} />} label="Delete Community account" danger onClick={() => showSheet(<DeleteAccountSheet />)} />
    </Group>
  );
}


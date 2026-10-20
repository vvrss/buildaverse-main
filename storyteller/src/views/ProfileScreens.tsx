import { useState } from 'preact/hooks';
import { Lock, PenLine, Plus, Shuffle, Signature, Sparkles } from 'lucide-preact';
import {
  PROFILE_COLORS,
  cancelUnlock,
  chooseProfile,
  createProfile,
  lockedProfile,
  profiles,
  unlock,
} from '../store/profile';
import { Avatar, ColorSwatches, Switch } from '../ui/controls';
import { PinPad } from '../ui/PinPad';

/** Two-step PIN entry: choose, then repeat. */
export function PinSetup({ onSet, onCancel }: { onSet: (pin: string) => void | Promise<void>; onCancel?: () => void }) {
  const [first, setFirst] = useState<string | null>(null);
  return (
    <div class="pin-setup">
      <PinPad
        key={first ? 'confirm' : 'choose'}
        label={first ? 'Enter the same PIN again' : 'Choose a 4-digit PIN'}
        onComplete={async (pin) => {
          if (!first) {
            setFirst(pin);
            return null;
          }
          if (pin !== first) {
            setFirst(null);
            return "The PINs didn't match. Choose a PIN again.";
          }
          await onSet(pin);
          return null;
        }}
      />
      {onCancel && (
        <button type="button" class="btn ghost" onClick={onCancel}>
          Cancel
        </button>
      )}
    </div>
  );
}

function ProfileForm({ onCancel, submitLabel }: { onCancel?: () => void; submitLabel: string }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(PROFILE_COLORS[profiles.value.length % PROFILE_COLORS.length]);
  const [usePin, setUsePin] = useState(false);
  const [step, setStep] = useState<'details' | 'pin'>('details');
  const [busy, setBusy] = useState(false);

  const finish = async (pin?: string) => {
    if (busy) return;
    setBusy(true);
    await createProfile({ name, color, pin });
  };

  if (step === 'pin') {
    return (
      <div class="profile-form">
        <Avatar name={name || 'Writer'} color={color} size={64} />
        <PinSetup onSet={(pin) => finish(pin)} onCancel={() => setStep('details')} />
      </div>
    );
  }

  return (
    <form
      class="profile-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        if (usePin) setStep('pin');
        else void finish();
      }}
    >
      <Avatar name={name || '?'} color={color} size={72} />
      <label class="field">
        <span>Your name</span>
        <input
          id="profile-name"
          type="text"
          value={name}
          maxLength={40}
          autoComplete="nickname"
          placeholder="e.g. Ana"
          onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
          data-testid="profile-name"
          autoFocus
        />
      </label>
      <div class="field">
        <span>Color</span>
        <ColorSwatches value={color} colors={PROFILE_COLORS} onChange={setColor} />
      </div>
      <div class="field inline">
        <span>
          <b>Lock with a PIN</b>
          <small>Others using this device can't open your stories.</small>
        </span>
        <Switch id="profile-pin" label="Lock with a PIN" checked={usePin} onChange={setUsePin} />
      </div>
      <div class="form-actions">
        {onCancel && (
          <button type="button" class="btn" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" class="btn primary wide" disabled={!name.trim() || busy} data-testid="create-profile">
          {submitLabel}
        </button>
      </div>
      <p class="fine-print">Your profile and stories stay on this device. Nothing is sent anywhere.</p>
    </form>
  );
}

export function Welcome() {
  const [step, setStep] = useState<'intro' | 'profile'>('intro');

  if (step === 'profile') {
    return (
      <div class="screen center-screen">
        <h1 class="display">Create your profile</h1>
        <ProfileForm submitLabel="Start writing" onCancel={() => setStep('intro')} />
      </div>
    );
  }

  return (
    <div class="screen center-screen welcome">
      <div class="welcome-art" aria-hidden="true">
        <div class="mini-bubble right" style="--c:#e76f51">
          <b>Ana</b>Did you hear that?
        </div>
        <div class="mini-bubble" style="--c:#2a9d8f">
          <b>Tom</b>Stay still.
        </div>
        <div class="mini-narration">The knocking stopped.</div>
      </div>
      <h1 class="display hero-title">Storyteller</h1>
      <p class="lead">Write stories as conversations, quickly, on any device.</p>
      <ul class="features">
        <li>
          <Shuffle size={20} />
          <span>
            <b>Swipe to switch speaker.</b> Enter even picks the next one for you.
          </span>
        </li>
        <li>
          <Signature size={20} />
          <span>
            <b>Draw shortcuts</b> with your finger: back, forward, undo, your own.
          </span>
        </li>
        <li>
          <Sparkles size={20} />
          <span>
            <b>Edit with any AI.</b> Stories are plain text it understands.
          </span>
        </li>
      </ul>
      <button type="button" class="btn primary wide" onClick={() => setStep('profile')} data-testid="get-started">
        <PenLine size={18} /> Get started
      </button>
      <p class="fine-print">Private by design: everything stays on this device.</p>
    </div>
  );
}

export function ProfilePicker() {
  const [adding, setAdding] = useState(false);

  if (adding) {
    return (
      <div class="screen center-screen">
        <h1 class="display">New profile</h1>
        <ProfileForm submitLabel="Create profile" onCancel={() => setAdding(false)} />
      </div>
    );
  }

  return (
    <div class="screen center-screen">
      <h1 class="display">Who's writing?</h1>
      <ul class="profile-grid">
        {profiles.value.map((p) => (
          <li key={p.id}>
            <button type="button" class="profile-tile" onClick={() => chooseProfile(p)}>
              <Avatar name={p.name} color={p.color} size={72} />
              <span class="profile-name">
                {p.name}
                {p.pin && <Lock size={14} aria-label="Locked with a PIN" />}
              </span>
            </button>
          </li>
        ))}
        <li>
          <button type="button" class="profile-tile add" onClick={() => setAdding(true)}>
            <span class="avatar add-avatar">
              <Plus size={28} />
            </span>
            <span class="profile-name">Add profile</span>
          </button>
        </li>
      </ul>
    </div>
  );
}

export function LockScreen() {
  const p = lockedProfile.value;
  if (!p) return null;
  return (
    <div class="screen center-screen lock">
      <Avatar name={p.name} color={p.color} size={72} />
      <h1 class="display">{p.name}</h1>
      <PinPad label="Enter your PIN" onComplete={unlock} />
      <button type="button" class="btn ghost" onClick={cancelUnlock}>
        Use another profile
      </button>
    </div>
  );
}

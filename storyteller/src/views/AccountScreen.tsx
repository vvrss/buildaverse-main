import { useEffect, useState } from 'preact/hooks';
import { ChevronLeft, KeyRound, Lock, LogOut, Trash2, Unlock, UserPlus } from 'lucide-preact';
import { db } from '../store/db';
import {
  PROFILE_COLORS,
  currentProfile,
  deleteCurrentProfile,
  lockNow,
  setPin,
  signOut,
  updateProfile,
  verifyCurrentPin,
} from '../store/profile';
import { showToast } from '../store/storyStore';
import { Avatar, ColorSwatches, Group, Row } from '../ui/controls';
import { PinPad } from '../ui/PinPad';
import { Sheet, closeSheet, confirmAction, showSheet } from '../ui/overlay';
import { PinSetup } from './ProfileScreens';

/** Asks for the current PIN, then runs `then`. */
function VerifyPinSheet({ title, then }: { title: string; then: () => void }) {
  return (
    <Sheet title={title}>
      <PinPad
        label="Enter your current PIN"
        onComplete={async (pin) => {
          if (!(await verifyCurrentPin(pin))) return 'Wrong PIN. Try again.';
          closeSheet();
          then();
          return null;
        }}
      />
    </Sheet>
  );
}

function NewPinSheet() {
  return (
    <Sheet title="Set a PIN">
      <PinSetup
        onSet={async (pin) => {
          await setPin(pin);
          closeSheet();
          showToast('PIN set. Your profile is now locked when you leave.');
        }}
      />
    </Sheet>
  );
}

export function AccountScreen() {
  const profile = currentProfile.value!;
  const [name, setName] = useState(profile.name);
  const [count, setCount] = useState(0);

  useEffect(() => {
    void db.listStories(profile.id).then((s) => setCount(s.length));
  }, [profile.id]);

  const saveName = () => {
    const clean = name.trim();
    if (clean && clean !== profile.name) void updateProfile({ name: clean });
    else setName(profile.name);
  };

  const remove = async () => {
    const ok = await confirmAction({
      title: `Delete ${profile.name}?`,
      message: (
        <p>
          This removes the profile and its {count} {count === 1 ? 'story' : 'stories'}, gestures and settings from this
          device. It can't be undone. Export a backup in Settings first if you might want them back.
        </p>
      ),
      confirmLabel: 'Delete profile',
      danger: true,
    });
    if (!ok) return;
    await deleteCurrentProfile();
  };

  return (
    <div class="screen account">
      <header class="screen-head with-back">
        <a class="icon-btn" href="#/settings" aria-label="Back to settings">
          <ChevronLeft size={24} />
        </a>
        <h1 class="display">Profile</h1>
      </header>

      <div class="account-hero">
        <Avatar name={name || profile.name} color={profile.color} size={88} />
        <input
          id="account-name"
          class="name-input"
          type="text"
          value={name}
          maxLength={40}
          aria-label="Name"
          onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
          onBlur={saveName}
          onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
        />
        <ColorSwatches value={profile.color} colors={PROFILE_COLORS} onChange={(color) => updateProfile({ color })} />
        <p class="muted small">
          {count} {count === 1 ? 'story' : 'stories'} · since {new Date(profile.createdAt).toLocaleDateString()}
        </p>
      </div>

      <Group title="Security" footer="The PIN keeps other people using this device out of your stories. It isn't encryption.">
        {profile.pin ? (
          <>
            <Row icon={<Lock size={20} />} label="Lock now" hint="Your PIN is needed to come back" onClick={() => lockNow()} />
            <Row
              icon={<KeyRound size={20} />}
              label="Change PIN"
              onClick={() => showSheet(<VerifyPinSheet title="Change PIN" then={() => showSheet(<NewPinSheet />)} />)}
            />
            <Row
              icon={<Unlock size={20} />}
              label="Remove PIN"
              onClick={() =>
                showSheet(
                  <VerifyPinSheet
                    title="Remove PIN"
                    then={async () => {
                      await setPin(null);
                      showToast('PIN removed');
                    }}
                  />,
                )
              }
            />
          </>
        ) : (
          <Row icon={<KeyRound size={20} />} label="Set a PIN" hint="Lock this profile with 4 digits" onClick={() => showSheet(<NewPinSheet />)} />
        )}
      </Group>

      <Group title="Profiles">
        <Row icon={<LogOut size={20} />} label="Switch profile" hint="Back to “Who’s writing?”" onClick={() => signOut()} />
        <Row icon={<UserPlus size={20} />} label="Add a profile" hint="For someone else on this device" onClick={() => signOut()} />
      </Group>

      <Group>
        <Row icon={<Trash2 size={20} />} label="Delete profile" danger onClick={remove} />
      </Group>
    </div>
  );
}

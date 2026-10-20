import { useEffect, useState } from 'preact/hooks';
import {
  ArchiveRestore,
  BookText,
  Download,
  HardDrive,
  Info,
  Keyboard,
  RefreshCw,
  ShieldCheck,
  Smartphone,
} from 'lucide-preact';
import { type Backup, exportBackup, parseBackup, restoreBackup } from '../export/backup';
import { saveFile } from '../export/files';
import { db } from '../store/db';
import { currentProfile } from '../store/profile';
import { type Settings, settings, updateSettings } from '../store/settings';
import { showToast } from '../store/storyStore';
import { Avatar, Group, Row, Segmented, Switch } from '../ui/controls';
import { Sheet, closeSheet, showSheet } from '../ui/overlay';
import { install, installPrompt, isIos, isStandalone, reloadToUpdate, updateReady } from '../ui/pwa';

function Toggle({ id, label, hint, field }: { id: string; label: string; hint?: string; field: keyof Settings }) {
  const value = settings.value[field] as boolean;
  return (
    <Row label={label} hint={hint} htmlFor={id}>
      <Switch id={id} label={label} checked={value} onChange={(v) => updateSettings({ [field]: v })} />
    </Row>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function RestoreSheet({ backup }: { backup: Backup }) {
  const [withSettings, setWithSettings] = useState(true);
  const [busy, setBusy] = useState(false);
  const date = backup.exportedAt ? new Date(backup.exportedAt).toLocaleString() : 'an unknown date';
  return (
    <Sheet title="Restore backup">
      <p class="confirm-message">
        Backup of <b>{backup.profile.name}</b> from {date}: {backup.stories.length}{' '}
        {backup.stories.length === 1 ? 'story' : 'stories'} and {backup.gestures.length}{' '}
        {backup.gestures.length === 1 ? 'gesture' : 'gestures'}. They are added to this profile; nothing here is
        overwritten, and stories you already have are skipped.
      </p>
      <div class="group-card">
        <Row label="Also restore settings" hint="Theme, writing and gesture preferences" htmlFor="restore-settings">
          <Switch id="restore-settings" label="Also restore settings" checked={withSettings} onChange={setWithSettings} />
        </Row>
      </div>
      <div class="sheet-actions">
        <button type="button" class="btn" onClick={() => closeSheet()}>
          Cancel
        </button>
        <button
          type="button"
          class="btn primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const r = await restoreBackup(backup, { settings: withSettings });
            closeSheet();
            showToast(
              `Restored ${r.stories} ${r.stories === 1 ? 'story' : 'stories'}` +
                (r.skipped ? `, skipped ${r.skipped} already here` : '') +
                (r.gestures ? `, ${r.gestures} gestures` : ''),
            );
          }}
        >
          Restore
        </button>
      </div>
    </Sheet>
  );
}

function FormatGuide() {
  return (
    <Sheet title="The .story format">
      <p class="muted small">Every story is plain text like this. Edit it in the Text tab, or hand it to any AI.</p>
      <pre class="code-sample">{`---
title: The Lighthouse
characters:
  ana: Ana Reyes  #e76f51
  tom: Tom        #2a9d8f
---

# Chapter 1
> The wind howled.
@ana: Did you hear that?
@tom (whispering): Stay still.
  (indented lines continue the line above)
// a note for yourself or the AI`}</pre>
    </Sheet>
  );
}

export function SettingsScreen() {
  const profile = currentProfile.value!;
  const s = settings.value;
  const [storage, setStorage] = useState<{ stories: number; usage?: number; persisted?: boolean }>({ stories: 0 });

  const loadStorage = async () => {
    const stories = (await db.listStories(profile.id)).length;
    const est = await navigator.storage?.estimate?.().catch(() => undefined);
    const persisted = await navigator.storage?.persisted?.().catch(() => undefined);
    setStorage({ stories, usage: est?.usage, persisted });
  };
  useEffect(() => {
    void loadStorage();
  }, []);

  const backup = async () => {
    const data = await exportBackup(profile);
    const day = new Date().toISOString().slice(0, 10);
    const outcome = await saveFile(`storyteller-backup-${day}.json`, JSON.stringify(data, null, 1), 'application/json');
    if (outcome === 'saved') showToast(`Backup saved: ${data.stories.length} stories`);
    else if (outcome === 'failed') showToast("Couldn't save the backup");
  };

  const pickBackup = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const parsed = parseBackup(await file.text());
    if ('error' in parsed) showToast(parsed.error);
    else showSheet(<RestoreSheet backup={parsed.backup} />);
  };

  const protect = async () => {
    const ok = await navigator.storage?.persist?.().catch(() => false);
    showToast(ok ? 'Your stories are protected from cleanup' : 'This browser decides on its own. Keep a backup.');
    void loadStorage();
  };

  return (
    <div class="screen settings">
      <header class="screen-head">
        <h1 class="display">Settings</h1>
      </header>

      <Group>
        <Row
          icon={<Avatar name={profile.name} color={profile.color} size={44} />}
          label={<b>{profile.name}</b>}
          hint={profile.pin ? 'Profile · locked with a PIN' : 'Profile on this device'}
          href="#/account"
        />
      </Group>

      <Group title="Appearance">
        <Row label="Theme" stack>
          <Segmented
            label="Theme"
            value={s.theme}
            options={[
              ['system', 'System'],
              ['light', 'Light'],
              ['dark', 'Dark'],
            ]}
            onChange={(theme) => updateSettings({ theme })}
          />
        </Row>
        <Row label="Text size" stack>
          <Segmented
            label="Text size"
            value={s.textSize}
            options={[
              ['small', 'Small'],
              ['medium', 'Medium'],
              ['large', 'Large'],
            ]}
            onChange={(textSize) => updateSettings({ textSize })}
          />
        </Row>
        <Toggle id="set-lead" field="leadOnRight" label="First character on the right" hint="Like your own messages in a chat" />
        <Toggle id="set-notes" field="showNotes" label="Show notes in the editor" />
      </Group>

      <Group title="Writing">
        <Toggle id="set-alt" field="autoAlternate" label="Switch speaker on Enter" hint="Picks whoever is most likely to answer" />
        <Toggle id="set-enter" field="enterSends" label="Enter sends the line" hint="When off, Enter adds a line break and Ctrl+Enter sends" />
        <Toggle id="set-swipe" field="invertSwipe" label="Reverse swipe direction" hint="Swipe right for the next character" />
        <Toggle id="set-haptics" field="haptics" label="Vibration feedback" hint="On phones that support it" />
      </Group>

      <Group title="Gestures">
        <Row label="Recognition" hint="Strict ignores sloppy strokes; relaxed accepts more" stack>
          <Segmented
            label="Gesture recognition"
            value={s.gestureSensitivity}
            options={[
              ['strict', 'Strict'],
              ['normal', 'Normal'],
              ['relaxed', 'Relaxed'],
            ]}
            onChange={(gestureSensitivity) => updateSettings({ gestureSensitivity })}
          />
        </Row>
        <Row icon={<Keyboard size={20} />} label="Shortcuts & gestures" hint="Built-ins, your own gestures, keys" href="#/shortcuts" />
      </Group>

      <Group
        title="Data"
        footer={
          storage.usage !== undefined
            ? `${storage.stories} ${storage.stories === 1 ? 'story' : 'stories'} · about ${formatBytes(storage.usage)} used on this device`
            : `${storage.stories} ${storage.stories === 1 ? 'story' : 'stories'} on this device`
        }
      >
        <Row icon={<Download size={20} />} label="Export full backup" hint="All stories, gestures and settings in one file" onClick={backup} />
        <label class="row tappable">
          <span class="row-icon">
            <ArchiveRestore size={20} />
          </span>
          <span class="row-text">
            <span class="row-label">Restore from backup</span>
            <span class="row-hint">Adds stories from a backup file</span>
          </span>
          <input type="file" accept=".json,application/json" hidden onChange={pickBackup} data-testid="restore-input" />
        </label>
        {typeof navigator.storage?.persist === 'function' && (
          <Row
            icon={<ShieldCheck size={20} />}
            label={storage.persisted ? 'Stories protected from cleanup' : 'Protect stories from cleanup'}
            hint={storage.persisted ? 'The browser won’t clear them to free space' : 'Ask the browser not to clear them when space runs low'}
            onClick={storage.persisted ? undefined : protect}
          />
        )}
      </Group>

      <Group title="App">
        {updateReady.value && (
          <Row icon={<RefreshCw size={20} />} label="Update available" hint="Reload to get the newest version" onClick={reloadToUpdate} />
        )}
        {installPrompt.value ? (
          <Row icon={<Smartphone size={20} />} label="Install app" hint="Open it from your home screen, offline" onClick={() => install()} />
        ) : (
          <Row
            icon={<Smartphone size={20} />}
            label={isStandalone() ? 'Installed' : 'Install app'}
            hint={
              isStandalone()
                ? 'Running as an app'
                : isIos()
                  ? 'In Safari: Share, then Add to Home Screen'
                  : 'Use your browser menu: Install or Add to Home screen'
            }
          />
        )}
        <Row icon={<BookText size={20} />} label="Story format guide" onClick={() => showSheet(<FormatGuide />)} />
        <Row icon={<HardDrive size={20} />} label="Where are my stories?" hint="Only on this device, in this browser. Nothing is uploaded." />
        <Row icon={<Info size={20} />} label="Version" hint={`Storyteller ${__APP_VERSION__}`} />
      </Group>
    </div>
  );
}

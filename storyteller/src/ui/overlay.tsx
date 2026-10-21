import { signal } from '@preact/signals';
import type { ComponentChildren, VNode } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { X } from 'lucide-preact';

/**
 * Bottom sheets and confirmations, rendered by one host inside the app shell
 * so they stay above the on-screen keyboard. Never uses alert/confirm, which
 * some hosts (like embedded viewers) block.
 */

interface Entry {
  id: number;
  node: VNode;
  /** Where focus goes back to when the sheet closes. */
  opener: HTMLElement | null;
}

export const sheets = signal<Entry[]>([]);
let nextId = 0;
/** Openers of sheets that just closed, so a sheet opened from a closing menu returns focus past it. */
const closedOpeners = new Map<number, HTMLElement | null>();

function openerFor(): HTMLElement | null {
  const active = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
  if (!active || active === document.body) return null;
  const host = active.closest<HTMLElement>('[data-sheet-id]');
  if (!host) return active;
  const id = Number(host.dataset.sheetId);
  // Opened from a sheet that stays open: focus returns into it. From a menu that is
  // closing: focus returns to whatever opened the menu.
  if (sheets.value.some((s) => s.id === id)) return active;
  return closedOpeners.get(id) ?? null;
}

export function showSheet(node: VNode): number {
  nextId += 1;
  sheets.value = [...sheets.value, { id: nextId, node, opener: openerFor() }];
  return nextId;
}

function restoreFocus(gone: Entry[]) {
  for (const g of gone) {
    closedOpeners.set(g.id, g.opener);
    if (closedOpeners.size > 20) closedOpeners.delete(closedOpeners.keys().next().value!);
  }
  const opener = gone[gone.length - 1]?.opener;
  let tries = 0;
  const attempt = () => {
    if (!opener?.isConnected) return;
    // Something else took focus meanwhile (a sheet opened from the closing menu focuses itself).
    const active = document.activeElement;
    if (active && active !== document.body && active !== opener) return;
    // Wait until the screen behind has rendered without `inert`.
    if (opener.closest('[inert]')) {
      if (tries++ < 20) requestAnimationFrame(attempt);
      return;
    }
    const hosts = document.querySelectorAll<HTMLElement>('.sheet-host');
    const top = hosts[hosts.length - 1];
    if (sheets.value.length > 0 && !top?.contains(opener)) return;
    opener.focus({ preventScroll: true });
  };
  setTimeout(attempt, 0);
}

export function closeSheet(id?: number) {
  const list = sheets.value;
  const gone = id === undefined ? list.slice(-1) : list.filter((s) => s.id === id);
  if (gone.length === 0) return;
  sheets.value = list.filter((s) => !gone.includes(s));
  restoreFocus(gone);
}

export function closeAllSheets() {
  const gone = sheets.value;
  if (gone.length === 0) return;
  sheets.value = [];
  restoreFocus(gone.slice(0, 1));
}

interface SheetProps {
  title: string;
  children: ComponentChildren;
  onClose?: () => void;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"])';

export function Sheet({ title, children, onClose }: SheetProps) {
  const panel = useRef<HTMLDivElement>(null);
  const close = () => (onClose ? onClose() : closeSheet());

  useEffect(() => {
    // Focus goes into the dialog (closeSheet brings it back to what opened it).
    const el = panel.current;
    const target =
      el?.querySelector<HTMLElement>('[data-autofocus]') ??
      el?.querySelector<HTMLElement>(`.sheet-body ${FOCUSABLE}`) ??
      el;
    target?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      // Only the top sheet reacts, so Esc closes one layer at a time.
      if (e.key !== 'Escape' || !el || el.closest('[inert]')) return;
      e.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div class="sheet-layer">
      <div class="sheet-backdrop" onClick={close} />
      <div class="sheet" role="dialog" aria-modal="true" aria-label={title} ref={panel} tabIndex={-1}>
        <div class="sheet-grip" aria-hidden="true" />
        <header class="sheet-head">
          <h2>{title}</h2>
          <button type="button" class="icon-btn" aria-label="Close" onClick={close}>
            <X size={20} />
          </button>
        </header>
        <div class="sheet-body">{children}</div>
      </div>
    </div>
  );
}

/** Makes everything except the top sheet unreachable (no focus, no clicks, hidden from screen readers). */
export function Inert({ on, children, sheetId }: { on: boolean; children: ComponentChildren; sheetId?: number }) {
  // Set during render, not in an effect, so focus can move back as soon as a sheet closes.
  return (
    <div class={sheetId === undefined ? 'inert-wrap' : 'inert-wrap sheet-host'} inert={on} data-sheet-id={sheetId}>
      {children}
    </div>
  );
}

export function SheetHost() {
  const list = sheets.value;
  return (
    <>
      {list.map((s, i) => (
        <Inert key={s.id} sheetId={s.id} on={i < list.length - 1}>
          {s.node}
        </Inert>
      ))}
    </>
  );
}

/** Wraps the screen so it is inert while any sheet is open. */
export function ScreenBehindSheets({ children, blocked = false }: { children: ComponentChildren; blocked?: boolean }) {
  return <Inert on={blocked || sheets.value.length > 0}>{children}</Inert>;
}

interface ConfirmOptions {
  title: string;
  message: ComponentChildren;
  confirmLabel: string;
  danger?: boolean;
}

export function confirmAction(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    let id = 0;
    const done = (ok: boolean) => {
      closeSheet(id);
      resolve(ok);
    };
    id = showSheet(
      <Sheet title={opts.title} onClose={() => done(false)}>
        <div class="confirm-message">{opts.message}</div>
        <div class="sheet-actions">
          {/* For deletions, Cancel gets the focus, so a stray Enter never deletes. */}
          <button type="button" class="btn" data-autofocus={opts.danger ? true : undefined} onClick={() => done(false)}>
            Cancel
          </button>
          <button
            type="button"
            class={`btn ${opts.danger ? 'danger-solid' : 'primary'}`}
            data-autofocus={opts.danger ? undefined : true}
            onClick={() => done(true)}
          >
            {opts.confirmLabel}
          </button>
        </div>
      </Sheet>,
    );
  });
}

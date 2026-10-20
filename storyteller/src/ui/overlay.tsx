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
}

export const sheets = signal<Entry[]>([]);
let nextId = 0;

export function showSheet(node: VNode): number {
  nextId += 1;
  sheets.value = [...sheets.value, { id: nextId, node }];
  return nextId;
}

export function closeSheet(id?: number) {
  const list = sheets.value;
  sheets.value = id === undefined ? list.slice(0, -1) : list.filter((s) => s.id !== id);
}

export function closeAllSheets() {
  sheets.value = [];
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
    // Focus goes into the dialog and comes back to what opened it.
    const opener = document.activeElement as HTMLElement | null;
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
    return () => {
      window.removeEventListener('keydown', onKey);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
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
function Inert({ on, children }: { on: boolean; children: ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.inert = on;
  }, [on]);
  return (
    <div ref={ref} class="inert-wrap">
      {children}
    </div>
  );
}

export function SheetHost() {
  const list = sheets.value;
  return (
    <>
      {list.map((s, i) => (
        <Inert key={s.id} on={i < list.length - 1}>
          {s.node}
        </Inert>
      ))}
    </>
  );
}

/** Wraps the screen so it is inert while any sheet is open. */
export function ScreenBehindSheets({ children }: { children: ComponentChildren }) {
  return <Inert on={sheets.value.length > 0}>{children}</Inert>;
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

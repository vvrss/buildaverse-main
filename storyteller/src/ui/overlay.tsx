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

export function Sheet({ title, children, onClose }: SheetProps) {
  const panel = useRef<HTMLDivElement>(null);
  const close = () => (onClose ? onClose() : closeSheet());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    panel.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div class="sheet-layer">
      <div class="sheet-backdrop" onClick={close} />
      <div class="sheet" role="dialog" aria-modal="true" aria-label={title} ref={panel}>
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

export function SheetHost() {
  return (
    <>
      {sheets.value.map((s) => (
        <div key={s.id}>{s.node}</div>
      ))}
    </>
  );
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
          <button type="button" class="btn" onClick={() => done(false)}>
            Cancel
          </button>
          <button
            type="button"
            class={`btn ${opts.danger ? 'danger-solid' : 'primary'}`}
            data-autofocus
            onClick={() => done(true)}
          >
            {opts.confirmLabel}
          </button>
        </div>
      </Sheet>,
    );
  });
}

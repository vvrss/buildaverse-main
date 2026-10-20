import type { ComponentChildren } from 'preact';
import { ChevronRight } from 'lucide-preact';

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = [...parts[0]][0] ?? '';
  const last = parts.length > 1 ? ([...parts[parts.length - 1]][0] ?? '') : '';
  return (first + last).toUpperCase();
}

export function Avatar({ name, color, size = 40 }: { name: string; color: string; size?: number }) {
  return (
    <span
      class="avatar"
      style={`--c:${color};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px`}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

export function Switch({ checked, onChange, label, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; id: string }) {
  return (
    <input
      id={id}
      type="checkbox"
      role="switch"
      class="switch"
      checked={checked}
      aria-label={label}
      onChange={(e) => onChange((e.currentTarget as HTMLInputElement).checked)}
    />
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div class="segmented" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={v === value}
          class={v === value ? 'on' : ''}
          onClick={() => onChange(v)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export function Group({ title, children, footer }: { title?: string; children: ComponentChildren; footer?: ComponentChildren }) {
  return (
    <section class="group">
      {title && <h2 class="group-title">{title}</h2>}
      <div class="group-card">{children}</div>
      {footer && <p class="group-footer">{footer}</p>}
    </section>
  );
}

interface RowProps {
  icon?: ComponentChildren;
  label: ComponentChildren;
  hint?: ComponentChildren;
  children?: ComponentChildren;
  onClick?: () => void;
  href?: string;
  danger?: boolean;
  /** For rows whose control is a labelled input. */
  htmlFor?: string;
  stack?: boolean;
}

export function Row({ icon, label, hint, children, onClick, href, danger, htmlFor, stack }: RowProps) {
  const body = (
    <>
      {icon && <span class="row-icon">{icon}</span>}
      <span class="row-text">
        {htmlFor ? <label for={htmlFor}>{label}</label> : <span class="row-label">{label}</span>}
        {hint && <span class="row-hint">{hint}</span>}
      </span>
      {children && <span class="row-control">{children}</span>}
      {(onClick || href) && !children && <ChevronRight size={18} class="row-chevron" aria-hidden="true" />}
    </>
  );
  const cls = `row${danger ? ' danger' : ''}${stack ? ' stack' : ''}`;
  if (href) {
    return (
      <a class={`${cls} tappable`} href={href}>
        {body}
      </a>
    );
  }
  if (onClick) {
    return (
      <button type="button" class={`${cls} tappable`} onClick={onClick}>
        {body}
      </button>
    );
  }
  return <div class={cls}>{body}</div>;
}

export function ColorSwatches({ value, colors, onChange }: { value: string; colors: string[]; onChange: (c: string) => void }) {
  return (
    <div class="swatches" role="radiogroup" aria-label="Color">
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={c.toLowerCase() === value.toLowerCase()}
          aria-label={c}
          class="swatch"
          style={`--c:${c}`}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  );
}

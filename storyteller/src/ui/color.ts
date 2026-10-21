/** Color helpers for text drawn on character and profile colors. */

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Accepts only hex colors, so user data can never inject CSS. */
export function safeColor(value: string | undefined, fallback = '#888888'): string {
  return value && HEX.test(value) ? value : fallback;
}

function channels(hex: string): [number, number, number] {
  let h = safeColor(hex).slice(1);
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Black or white, whichever reads better on `background`. */
export function readableOn(background: string): string {
  return contrast(background, '#ffffff') >= contrast(background, '#000000') ? '#ffffff' : '#000000';
}

function toHsl(hex: string): [number, number, number] {
  const [r, g, b] = channels(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function fromHsl(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return `#${[r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The reader's background, taken from a story's cover or first character:
 * the same hue, calmed down, and dark enough that white text reads easily.
 */
export function readerBackground(color: string | undefined): string {
  const [h, s] = toHsl(safeColor(color, '#5d6a7e'));
  const sat = s < 0.08 ? s : Math.min(0.46, Math.max(0.22, s * 0.75));
  let l = 0.44;
  let hex = fromHsl(h, sat, l);
  while (contrast(hex, '#ffffff') < 5.6 && l > 0.08) {
    l -= 0.02;
    hex = fromHsl(h, sat, l);
  }
  return hex;
}

/** CSS variables for an element tinted with `color`: the color itself and the text color on it. */
export const tint = (color: string | undefined) => {
  const c = safeColor(color);
  return `--c:${c};--on-c:${readableOn(c)}`;
};

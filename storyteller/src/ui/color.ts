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

/** CSS variables for an element tinted with `color`: the color itself and the text color on it. */
export const tint = (color: string | undefined) => {
  const c = safeColor(color);
  return `--c:${c};--on-c:${readableOn(c)}`;
};

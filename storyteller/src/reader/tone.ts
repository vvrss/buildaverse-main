import { useEffect, useState } from 'preact/hooks';
import type { Story } from '../format/types';
import { readerBackground } from '../ui/color';

const hex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/**
 * The color a picture "feels" like: its pixels averaged, with vivid mid-tones
 * counting more than greys, whites and blacks. Null when it can't be read.
 */
export function averageColor(src: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      try {
        const size = 24;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const g = canvas.getContext('2d', { willReadFrequently: true });
        if (!g) return resolve(null);
        g.drawImage(img, 0, 0, size, size);
        const d = g.getImageData(0, 0, size, size).data;
        let r = 0;
        let gr = 0;
        let b = 0;
        let total = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 128) continue;
          const max = Math.max(d[i], d[i + 1], d[i + 2]);
          const min = Math.min(d[i], d[i + 1], d[i + 2]);
          const sat = max ? (max - min) / max : 0;
          const light = (max + min) / 510;
          const w = 0.15 + sat * (1 - Math.abs(light - 0.5) * 1.4);
          r += d[i] * w;
          gr += d[i + 1] * w;
          b += d[i + 2] * w;
          total += w;
        }
        resolve(total ? hex(r / total, gr / total, b / total) : null);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * The reader's background for a story: from its cover when there is one,
 * otherwise from its first character.
 */
export function useReaderTone(story: Story | null, coverSrc: string | undefined): string {
  const fallback = readerBackground(story?.characters[0]?.color);
  const [fromCover, setFromCover] = useState<{ src: string; color: string } | null>(null);
  useEffect(() => {
    if (!coverSrc) return;
    let alive = true;
    void averageColor(coverSrc).then((c) => {
      if (alive && c) setFromCover({ src: coverSrc, color: readerBackground(c) });
    });
    return () => {
      alive = false;
    };
  }, [coverSrc]);
  return fromCover && fromCover.src === coverSrc ? fromCover.color : fallback;
}

/**
 * While reading, the window around the app (wide screens) and the phone's
 * browser bar take the reader's color too.
 */
export function usePageTone(tone: string | null) {
  useEffect(() => {
    if (!tone) return;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const before = meta?.content;
    document.body.style.background = tone;
    meta?.setAttribute('content', tone);
    return () => {
      document.body.style.background = '';
      if (meta && before) meta.setAttribute('content', before);
    };
  }, [tone]);
}

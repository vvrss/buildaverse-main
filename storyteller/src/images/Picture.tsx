import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import { ImageOff } from 'lucide-preact';
import { initials } from '../ui/controls';
import { tint } from '../ui/color';
import { usePicture } from './pictures';

/**
 * How a picture code becomes an image. In the editor that is this device's
 * picture store; the Community reader provides the server's copies instead.
 * The resolver is a hook, so each provider must keep the same one.
 */
export interface PictureSrc {
  src: string;
  srcset?: string;
  /** Same widths as AVIF, offered first where the browser supports it. */
  avifSrcset?: string;
  width: number;
  height: number;
}
export type PictureResolver = (ref: string | undefined) => PictureSrc | null | undefined;

function useLocal(ref: string | undefined): PictureSrc | null | undefined {
  const p = usePicture(ref);
  return p ? { src: p.url, width: p.width, height: p.height } : p;
}

export const PictureContext = createContext<PictureResolver>(useLocal);

interface Props {
  pictureRef: string | undefined;
  alt: string;
  /** CSS sizes for srcset. */
  sizes?: string;
  class?: string;
  /** Load right away instead of when scrolled near. */
  eager?: boolean;
}

/** A picture with its size reserved before it loads, so the page never jumps. */
export function Picture({ pictureRef, alt, sizes = '(max-width: 640px) 92vw, 560px', class: cls = '', eager = false }: Props) {
  const resolve = useContext(PictureContext);
  const p = resolve(pictureRef);
  if (p === undefined) return <span class={`pic loading ${cls}`} aria-hidden="true" />;
  if (p === null) {
    return (
      <span class={`pic missing ${cls}`} role="img" aria-label={alt ? `Picture not available: ${alt}` : 'Picture not available'}>
        <ImageOff size={22} />
        <span>Picture not on this device</span>
      </span>
    );
  }
  const img = (
    <img
      class={`pic ${cls}`}
      src={p.src}
      srcset={p.srcset}
      sizes={p.srcset ? sizes : undefined}
      width={p.width}
      height={p.height}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      style={`aspect-ratio:${p.width}/${p.height}`}
    />
  );
  return p.avifSrcset ? (
    <picture>
      <source type="image/avif" srcset={p.avifSrcset} sizes={sizes} />
      {img}
    </picture>
  ) : (
    img
  );
}

/** A character's portrait in a circle, or their initials when there is none. */
export function Portrait({ name, color, portrait, size = 34 }: { name: string; color: string; portrait?: string; size?: number }) {
  const resolve = useContext(PictureContext);
  const p = resolve(portrait);
  const style = `${tint(color)};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px`;
  if (portrait && p) {
    return (
      <span class="portrait" style={style} aria-hidden="true">
        <img src={p.src} srcset={p.srcset} sizes={`${size}px`} alt="" width={size} height={size} decoding="async" />
      </span>
    );
  }
  return (
    <span class="portrait avatar" style={style} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

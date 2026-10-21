import type { ComponentChildren } from 'preact';
import { useMemo } from 'preact/hooks';
import { PictureContext, type PictureResolver, type PictureSrc } from '../images/Picture';
import type { MediaInfo, MediaMap } from '../shared/api';

/** A server picture as an <img> source with every width it is served at. */
export function mediaSrc(m: MediaInfo): PictureSrc {
  const url = (w: number, ext: 'webp' | 'avif') => `/media/${m.id}/${w}.${ext}`;
  const set = (ext: 'webp' | 'avif') => m.widths.map((w) => `${url(w, ext)} ${w}w`).join(', ');
  const fallback = m.widths.includes(960) ? 960 : m.widths[m.widths.length - 1];
  return {
    src: url(fallback, 'webp'),
    srcset: set('webp'),
    avifSrcset: m.avif ? set('avif') : undefined,
    width: m.w,
    height: m.h,
  };
}

/** Pictures inside it come from the server's copies of an episode's pictures. */
export function RemotePictures({ media, children }: { media: MediaMap; children: ComponentChildren }) {
  // Not a hook inside: the same resolver kind for the whole subtree.
  const resolve = useMemo<PictureResolver>(() => (ref) => (ref && media[ref] ? mediaSrc(media[ref]) : null), [media]);
  return <PictureContext.Provider value={resolve}>{children}</PictureContext.Provider>;
}

/** One server picture (covers), with its size reserved. */
export function RemoteImage({ media, alt, sizes, class: cls = '' }: { media: MediaInfo; alt: string; sizes: string; class?: string }) {
  const p = mediaSrc(media);
  const img = (
    <img
      class={`pic ${cls}`}
      src={p.src}
      srcset={p.srcset}
      sizes={sizes}
      width={p.width}
      height={p.height}
      alt={alt}
      loading="lazy"
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

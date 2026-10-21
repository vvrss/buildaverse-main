import { useEffect, useRef } from 'preact/hooks';
import { ChevronDown, PenLine, RotateCcw } from 'lucide-preact';
import { usePicture } from '../images/pictures';
import { go, goBack, storyPath } from '../router';
import { story } from '../store/storyStore';
import { Lyrics } from './Lyrics';
import { usePageTone, useReaderTone } from './tone';

/** Reading your own story back, full screen, like lyrics. */
export function ReadScreen({ id }: { id: string }) {
  const s = story.value;
  const scroller = useRef<HTMLDivElement>(null);
  const cover = usePicture(s.cover);
  const tone = useReaderTone(s, cover?.url);
  usePageTone(tone);
  const close = () => goBack(storyPath(id));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.sheet-layer')) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [id]);

  const names = s.characters.map((c) => c.name);
  const cast = names.length > 2 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names.join(' and ');

  return (
    <div class="screen ly-scroller reading" ref={scroller} style={`--ly-bg:${tone}`}>
      <header class="ly-top">
        <button type="button" class="icon-btn" aria-label="Close reader" onClick={close}>
          <ChevronDown size={26} />
        </button>
        <span class="ly-top-title">{s.title}</span>
        <span class="ly-top-space" />
      </header>
      <Lyrics
        story={s}
        scroller={scroller}
        autoplay
        head={
          <div class="ly-intro">
            {cast && <p class="ly-eyebrow">{cast}</p>}
            <h1>{s.title}</h1>
          </div>
        }
        foot={({ restart }) => (
          <div class="ly-end">
            <p class="ly-eyebrow">The end</p>
            <div class="action-row">
              <button type="button" class="btn" onClick={restart}>
                <RotateCcw size={16} /> Read again
              </button>
              <button type="button" class="btn primary" onClick={() => go(storyPath(id), true)}>
                <PenLine size={16} /> Back to writing
              </button>
            </div>
          </div>
        )}
      />
    </div>
  );
}

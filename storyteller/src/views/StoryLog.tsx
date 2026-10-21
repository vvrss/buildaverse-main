import { Fragment } from 'preact';
import type { Story } from '../format/types';
import type { Mode } from '../store/storyStore';
import { LineView } from './LineView';

interface Props {
  story: Story;
  /** The first character in the cast is drawn on the right ("you" in a chat). */
  leadOnRight: boolean;
  showNotes: boolean;
  /** The editor's position: the line being edited, or where new lines go. */
  mode?: Mode;
  onSelect: (index: number) => void;
}

/** A story as a chat: bubbles, narration, headings, pictures and portraits. */
export function StoryLog({ story, leadOnRight, showNotes, mode, onSelect }: Props) {
  const castById = new Map(story.characters.map((c) => [c.id, c]));
  const lead = leadOnRight ? story.characters[0]?.id : undefined;
  return (
    <>
      {story.blocks.map((block, i) => {
        if (block.kind === 'note' && !showNotes && !(mode?.type === 'edit' && mode.index === i)) return null;
        const prev = story.blocks[i - 1];
        const showName = block.kind === 'line' && !(prev?.kind === 'line' && prev.speaker === block.speaker && !block.direction);
        return (
          <Fragment key={block.id}>
            <LineView
              block={block}
              index={i}
              character={block.kind === 'line' ? castById.get(block.speaker) : undefined}
              isLead={block.kind === 'line' && block.speaker === lead}
              showName={showName}
              selected={mode?.type === 'edit' && mode.index === i}
              onSelect={onSelect}
            />
            {mode?.type === 'new' && mode.at === i + 1 && mode.at < story.blocks.length && (
              <div class="insert-caret" aria-hidden="true" />
            )}
          </Fragment>
        );
      })}
    </>
  );
}

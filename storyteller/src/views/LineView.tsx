import type { Block, Character } from '../format/types';
import { Picture, Portrait } from '../images/Picture';
import { tint } from '../ui/color';

interface Props {
  block: Block;
  index: number;
  character?: Character;
  /** First character in the cast is drawn on the right, like "you" in a chat. */
  isLead: boolean;
  showName: boolean;
  selected: boolean;
  onSelect: (index: number) => void;
}

export function LineView({ block, index, character, isLead, showName, selected, onSelect }: Props) {
  const cls = selected ? ' selected' : '';
  const select = () => onSelect(index);
  const lines = (text: string) => text.split('\n').map((l, i) => <p key={i}>{l || '…'}</p>);

  switch (block.kind) {
    case 'heading':
      return (
        <div class={`blk heading${cls}`} data-index={index} onClick={select}>
          <span>{block.text || 'Untitled scene'}</span>
        </div>
      );
    case 'narration':
      return (
        <div class={`blk narration${cls}`} data-index={index} onClick={select}>
          {lines(block.text)}
        </div>
      );
    case 'note':
      return (
        <div class={`blk note${cls}`} data-index={index} onClick={select}>
          <span class="tag">note</span>
          {lines(block.text)}
        </div>
      );
    case 'image':
      return (
        <figure class={`blk image${cls}`} data-index={index} onClick={select}>
          <Picture pictureRef={block.ref} alt={block.text} />
          {block.text && <figcaption>{block.text}</figcaption>}
        </figure>
      );
    case 'line': {
      const portrait = character?.portrait;
      return (
        <div
          class={`blk line${isLead ? ' lead' : ''}${showName ? ' first' : ''}${portrait ? ' with-portrait' : ''}${cls}`}
          data-index={index}
          style={tint(character?.color)}
          onClick={select}
        >
          {portrait &&
            (showName ? (
              <Portrait name={character.name} color={character.color} portrait={portrait} />
            ) : (
              <span class="portrait-spacer" aria-hidden="true" />
            ))}
          <div class="line-body">
            {showName && (
              <div class="who">
                {character?.name ?? block.speaker}
                {block.direction && <i> ({block.direction})</i>}
              </div>
            )}
            <div class="bubble">
              {!showName && block.direction && <i class="dir">({block.direction}) </i>}
              {lines(block.text)}
            </div>
          </div>
        </div>
      );
    }
  }
}

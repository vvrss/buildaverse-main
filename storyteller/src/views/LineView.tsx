import type { Block, Character } from '../format/types';

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
    case 'line':
      return (
        <div
          class={`blk line${isLead ? ' lead' : ''}${showName ? ' first' : ''}${cls}`}
          data-index={index}
          style={`--c:${character?.color ?? '#888'}`}
          onClick={select}
        >
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
      );
  }
}

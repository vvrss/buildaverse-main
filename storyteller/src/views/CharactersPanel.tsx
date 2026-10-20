import { useState } from 'preact/hooks';
import type { Character } from '../format/types';
import { countLines } from '../store/logic';
import {
  addCharacter,
  changeCharacterId,
  deleteCharacter,
  moveCharacter,
  showToast,
  story,
  updateCharacter,
} from '../store/storyStore';

function CharacterRow({ c, index, total }: { c: Character; index: number; total: number }) {
  const [id, setId] = useState(c.id);
  const [error, setError] = useState<string | null>(null);
  const used = countLines(story.value, c.id);

  const commitId = () => {
    const err = changeCharacterId(c.id, id);
    setError(err);
    if (err) setId(c.id);
  };

  return (
    <li class="cast-row">
      <input
        type="color"
        value={c.color}
        aria-label={`Color for ${c.name}`}
        onInput={(e) => updateCharacter(c.id, { color: (e.currentTarget as HTMLInputElement).value })}
      />
      <div class="cast-fields">
        <input
          type="text"
          value={c.name}
          aria-label="Display name"
          onInput={(e) => updateCharacter(c.id, { name: (e.currentTarget as HTMLInputElement).value })}
        />
        <label class="id-field">
          @
          <input
            type="text"
            value={id}
            aria-label="Id used in the text format"
            onInput={(e) => setId((e.currentTarget as HTMLInputElement).value)}
            onBlur={commitId}
            onKeyDown={(e) => e.key === 'Enter' && commitId()}
          />
        </label>
        <span class="muted small">
          {index < 9 ? `Alt+${index + 1} · ` : ''}
          {used} {used === 1 ? 'line' : 'lines'}
        </span>
        {error && <span class="error small">{error}</span>}
      </div>
      <div class="cast-actions">
        <button type="button" aria-label="Move up" disabled={index === 0} onClick={() => moveCharacter(c.id, -1)}>
          ↑
        </button>
        <button type="button" aria-label="Move down" disabled={index === total - 1} onClick={() => moveCharacter(c.id, 1)}>
          ↓
        </button>
        <button
          type="button"
          aria-label={`Remove ${c.name}`}
          title={used ? 'Has lines: change or delete them first' : 'Remove'}
          disabled={used > 0}
          onClick={() => deleteCharacter(c.id) && showToast(`${c.name} removed`)}
        >
          ✕
        </button>
      </div>
    </li>
  );
}

export function CharactersPanel() {
  const [name, setName] = useState('');
  const cast = story.value.characters;

  const add = (e: Event) => {
    e.preventDefault();
    if (addCharacter(name)) setName('');
  };

  return (
    <div class="page cast">
      <p class="muted small">
        The order sets the swipe order and the Alt+number keys. The first character appears on the right, like "you" in a
        chat. Changing an @id updates every line.
      </p>
      <ul class="cast-list">
        {cast.map((c, i) => (
          <CharacterRow key={c.id} c={c} index={i} total={cast.length} />
        ))}
      </ul>
      <form class="add-row" onSubmit={add}>
        <input
          type="text"
          placeholder="New character name"
          value={name}
          onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
          data-testid="new-character"
        />
        <button type="submit" class="primary">
          Add
        </button>
      </form>
    </div>
  );
}

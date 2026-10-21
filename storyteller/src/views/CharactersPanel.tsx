import { useState } from 'preact/hooks';
import { ImagePlus, Trash2 } from 'lucide-preact';
import type { Character } from '../format/types';
import { Picture, Portrait } from '../images/Picture';
import { chooseCover, choosePortrait } from '../images/flows';
import { countLines } from '../store/logic';
import {
  addCharacter,
  changeCharacterId,
  deleteCharacter,
  moveCharacter,
  setCover,
  showToast,
  story,
  updateCharacter,
} from '../store/storyStore';

function setPortrait(c: Character, ref: string | undefined) {
  updateCharacter(c.id, { portrait: ref });
}

function CharacterRow({ c, index, total }: { c: Character; index: number; total: number }) {
  const [id, setId] = useState(c.id);
  const [error, setError] = useState<string | null>(null);
  const used = countLines(story.value, c.id);

  const commitId = () => {
    const err = changeCharacterId(c.id, id);
    setError(err);
    if (err) setId(c.id);
  };

  const pickPortrait = async () => {
    const ref = await choosePortrait(c.name);
    if (ref) setPortrait(c, ref);
  };

  return (
    <li class="cast-row">
      <div class="cast-look">
        <button type="button" class="portrait-btn" aria-label={`Portrait for ${c.name}`} onClick={pickPortrait}>
          <Portrait name={c.name} color={c.color} portrait={c.portrait} size={44} />
        </button>
        <input
          type="color"
          value={c.color}
          aria-label={`Color for ${c.name}`}
          onInput={(e) => updateCharacter(c.id, { color: (e.currentTarget as HTMLInputElement).value })}
        />
        {c.portrait && (
          <button type="button" class="link small" aria-label={`Remove the portrait of ${c.name}`} onClick={() => setPortrait(c, undefined)}>
            Remove
          </button>
        )}
      </div>
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

  const cover = story.value.cover;
  const pickCover = async () => {
    const ref = await chooseCover();
    if (ref) setCover(ref);
  };

  return (
    <div class="page cast">
      <section class="cover-pick">
        {cover ? (
          <button type="button" class="cover-btn" aria-label="Change the cover" onClick={pickCover}>
            <Picture pictureRef={cover} alt="Cover" class="cover-img" eager />
          </button>
        ) : (
          <button type="button" class="cover-btn empty" onClick={pickCover} data-testid="add-cover">
            <ImagePlus size={22} />
            <span>Add a cover</span>
          </button>
        )}
        {cover && (
          <button type="button" class="link small" onClick={() => setCover(undefined)}>
            <Trash2 size={14} /> Remove cover
          </button>
        )}
      </section>
      <p class="muted small">
        The order sets the swipe order and the Alt+number keys. The first character appears on the right, like "you" in a
        chat. Changing an @id updates every line. Tap a circle to give a character a portrait.
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

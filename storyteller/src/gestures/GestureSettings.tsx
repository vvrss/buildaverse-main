import { useEffect, useState } from 'preact/hooks';
import { parseStory } from '../format/parser';
import { type Character, idKey } from '../format/types';
import { bindableActions, describeAction } from '../shortcuts/actions';
import { HOTKEY_HELP } from '../shortcuts/hotkeys';
import { COMMANDS } from '../shortcuts/prefixes';
import { type Point, db } from '../store/db';
import { profileId } from '../store/session';
import { GESTURE_THRESHOLDS, settings } from '../store/settings';
import { Switch } from '../ui/controls';
import { BUILTIN_GESTURES } from './defaults';
import { makeTemplates, rank } from './recognizer';
import { customGestures, disabledBuiltins, removeGesture, saveGesture, templates, toggleBuiltin } from './store';
import { StrokeCanvas, StrokeThumb } from './StrokeCanvas';

const SAMPLES_NEEDED = 3;

/** Characters from this profile's own stories, for binding gestures to them. */
function useProfileCharacters(): Character[] {
  const [cast, setCast] = useState<Character[]>([]);
  const owner = profileId.value;
  useEffect(() => {
    if (!owner) return;
    let alive = true;
    void db.listStories(owner).then((records) => {
      const seen = new Map<string, Character>();
      for (const r of records) {
        for (const c of parseStory(r.text).story.characters) {
          if (!seen.has(idKey(c.id))) seen.set(idKey(c.id), c);
        }
      }
      if (alive) setCast([...seen.values()]);
    });
    return () => {
      alive = false;
    };
  }, [owner]);
  return cast;
}

function Recorder() {
  const actions = bindableActions(useProfileCharacters());
  const [action, setAction] = useState('nav.prev');
  const [samples, setSamples] = useState<Point[][]>([]);
  const [warning, setWarning] = useState<string | null>(null);

  const onStroke = (points: Point[]) => {
    if (samples.length >= SAMPLES_NEEDED) return;
    // Warn when the new shape is too close to a different existing gesture.
    const threshold = GESTURE_THRESHOLDS[settings.value.gestureSensitivity];
    const clash = rank(points, templates.value).find((m) => m.action !== action && m.score >= threshold);
    setWarning(clash ? `Looks a lot like the gesture for "${describeAction(clash.action)}". Consider another shape.` : null);
    setSamples([...samples, points]);
  };

  const save = async () => {
    await saveGesture(action, samples);
    setSamples([]);
    setWarning(null);
  };

  return (
    <div class="recorder">
      <label>
        Action
        <select value={action} onChange={(e) => setAction((e.currentTarget as HTMLSelectElement).value)}>
          {actions.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </label>
      <p class="muted small">
        Draw the symbol {SAMPLES_NEEDED} times in the box ({samples.length}/{SAMPLES_NEEDED}). A letter works well, like
        "A" for Ana.
      </p>
      <StrokeCanvas class="record-canvas" label="Draw your gesture here" onStroke={onStroke} />
      <div class="samples">
        {samples.map((s, i) => (
          <StrokeThumb key={i} points={s} />
        ))}
      </div>
      {warning && <p class="warn small">{warning}</p>}
      <div class="actions">
        <button type="button" class="primary" disabled={samples.length < SAMPLES_NEEDED} onClick={save}>
          Save gesture
        </button>
        <button type="button" disabled={samples.length === 0} onClick={() => setSamples([])}>
          Redraw
        </button>
      </div>
    </div>
  );
}

function Tester() {
  const [result, setResult] = useState<string>('Draw anything to see what it matches.');
  const onStroke = (points: Point[]) => {
    const [top, second] = rank(points, templates.value);
    if (!top) return setResult('Too short.');
    const pct = (n: number) => `${Math.round(n * 100)}%`;
    const threshold = GESTURE_THRESHOLDS[settings.value.gestureSensitivity];
    setResult(
      `${describeAction(top.action)} · ${pct(top.score)}${top.score < threshold ? ' (too low, ignored)' : ''}` +
        (second ? ` — next best: ${describeAction(second.action)} ${pct(second.score)}` : ''),
    );
  };
  return (
    <div class="tester">
      <StrokeCanvas class="record-canvas small" label="Test a gesture" onStroke={onStroke} />
      <p class="small" data-testid="gesture-test-result">
        {result}
      </p>
    </div>
  );
}

export function ShortcutsPage() {
  return (
    <div class="screen shortcuts">
      <header class="screen-head">
        <h1 class="display">Gestures & shortcuts</h1>
      </header>

      <section>
        <h2>Built-in gestures</h2>
        <p class="muted small">Open the gesture pad with the pen button above the keyboard, by swiping up on the character chips, or with Alt+G.</p>
        <ul class="gesture-list">
          {BUILTIN_GESTURES.map((g) => (
            <li key={g.id}>
              <StrokeThumb points={makeTemplates(g.action, [g.stroke])[0]?.points ?? g.stroke} />
              <span>
                <b>{g.symbol}</b> {describeAction(g.action)}
              </span>
              <Switch
                id={`builtin-${g.id}`}
                label={`${describeAction(g.action)} gesture`}
                checked={!disabledBuiltins.value.includes(g.id)}
                onChange={() => toggleBuiltin(g.id)}
              />
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Your gestures</h2>
        {customGestures.value.length === 0 && <p class="muted small">None yet.</p>}
        <ul class="gesture-list">
          {customGestures.value.map((g) => (
            <li key={g.id}>
              <StrokeThumb points={g.samples[0]} />
              <span>{describeAction(g.action)}</span>
              <button type="button" class="ghost" aria-label="Delete gesture" onClick={() => removeGesture(g.id)}>
                🗑
              </button>
            </li>
          ))}
        </ul>
        <h3>Record a new one</h3>
        <Recorder />
        <h3>Test</h3>
        <Tester />
      </section>

      <section>
        <h2>Typed shortcuts</h2>
        <table class="keys">
          <tbody>
            <tr><td><code>@name</code></td><td>Switch speaker (an unknown name creates a character)</td></tr>
            <tr><td><code>&gt; text</code></td><td>Narration</td></tr>
            <tr><td><code># text</code></td><td>Heading</td></tr>
            <tr><td><code>// text</code></td><td>Note</td></tr>
            <tr><td><code>(tone) text</code></td><td>Stage direction</td></tr>
            {COMMANDS.map((c) => (
              <tr key={c.cmd}>
                <td><code>/{c.cmd}</code> + space</td>
                <td>{c.help}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Keyboard (desktop)</h2>
        <table class="keys">
          <tbody>
            {HOTKEY_HELP.map(([k, v]) => (
              <tr key={k}>
                <td><kbd>{k}</kbd></td>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

import { X } from 'lucide-preact';
import { canRun, describeAction, runAction } from '../shortcuts/actions';
import { GESTURE_THRESHOLDS, haptic, settings } from '../store/settings';
import { showToast } from '../store/storyStore';
import { gesturePadOpen } from '../store/ui';
import { BUILTIN_GESTURES } from './defaults';
import { recognize } from './recognizer';
import { customGestures, disabledBuiltins, templates } from './store';
import { StrokeCanvas, StrokeThumb } from './StrokeCanvas';

/** Overlay you draw shortcut symbols on. A tap (no stroke) closes it. */
export function GesturePad() {
  if (!gesturePadOpen.value) return null;

  const onStroke = (points: { x: number; y: number }[]) => {
    // Gestures for characters that aren't in this story can't match by accident.
    const usable = templates.value.filter((t) => canRun(t.action));
    const match = recognize(points, usable, GESTURE_THRESHOLDS[settings.value.gestureSensitivity]);
    if (!match) {
      showToast('Not recognized. Draw again, or tap to close');
      return;
    }
    const label = runAction(match.action);
    if (!label) {
      showToast(`${describeAction(match.action)} isn't in this story`);
      return;
    }
    showToast(`✓ ${label}`);
    haptic(8);
  };

  const builtins = BUILTIN_GESTURES.filter((g) => !disabledBuiltins.value.includes(g.id));

  return (
    <div class="pad" data-testid="gesture-pad">
      <StrokeCanvas
        class="pad-canvas"
        label="Gesture pad: draw a symbol"
        onStroke={onStroke}
        onTap={() => (gesturePadOpen.value = false)}
      />
      <div class="pad-hints" aria-hidden="true">
        <p>Draw a shortcut · tap to close</p>
        <ul>
          {builtins.map((g) => (
            <li key={g.id}>
              <b>{g.symbol}</b> {describeAction(g.action)}
            </li>
          ))}
          {customGestures.value.map((g) => (
            <li key={g.id}>
              <StrokeThumb points={g.samples[0]} size={22} /> {describeAction(g.action)}
            </li>
          ))}
        </ul>
      </div>
      <button
        type="button"
        class="pad-close"
        aria-label="Close gesture pad"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (gesturePadOpen.value = false)}
      >
        <X size={20} />
      </button>
    </div>
  );
}

import { useEffect, useState } from 'preact/hooks';
import { Delete } from 'lucide-preact';

interface Props {
  /** Called with the 4 digits; return an error to show, or null to accept. */
  onComplete: (pin: string) => Promise<string | null> | string | null;
  label: string;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];

/** A 4-digit PIN entry with an on-screen keypad and keyboard support. */
export function PinPad({ onComplete, label }: Props) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const press = async (key: string) => {
    if (busy) return;
    if (key === 'del') {
      setPin((p) => p.slice(0, -1));
      return;
    }
    if (!/^\d$/.test(key) || pin.length >= 4) return;
    const next = pin + key;
    setPin(next);
    setError(null);
    if (next.length === 4) {
      setBusy(true);
      const err = await onComplete(next);
      setBusy(false);
      setPin('');
      if (err) {
        setError(err);
        navigator.vibrate?.([30, 40, 30]);
      }
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) void press(e.key);
      else if (e.key === 'Backspace') void press('del');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div class="pinpad">
      <p class="pin-label" id="pin-label">
        {label}
      </p>
      <div class={`pin-dots${error ? ' shake' : ''}`} aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} class={i < pin.length ? 'on' : ''} />
        ))}
      </div>
      <p class="pin-error" role="alert">
        {error ?? ' '}
      </p>
      <div class="pin-keys" role="group" aria-labelledby="pin-label">
        {KEYS.map((k, i) =>
          k === '' ? (
            <span key={i} />
          ) : (
            <button
              key={i}
              type="button"
              class="pin-key"
              aria-label={k === 'del' ? 'Delete digit' : k}
              onClick={() => press(k)}
            >
              {k === 'del' ? <Delete size={22} /> : k}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

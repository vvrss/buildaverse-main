import { useEffect, useRef, useState } from 'preact/hooks';
import { Delete } from 'lucide-preact';

interface Props {
  /** Called with the 4 digits; return an error to show, or null to accept. */
  onComplete: (pin: string) => Promise<string | null> | string | null;
  label: string;
  /** A message to show from the start, e.g. after a mismatch in a previous step. */
  message?: string | null;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];

/** A 4-digit PIN entry with an on-screen keypad and keyboard support. */
export function PinPad({ onComplete, label, message = null }: Props) {
  const [pin, setPinState] = useState('');
  const [error, setError] = useState<string | null>(message);
  // Refs hold the live values, so keys typed faster than a render are all counted
  // and a full PIN is submitted exactly once.
  const pinRef = useRef('');
  const busyRef = useRef(false);
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;

  const setPin = (value: string) => {
    pinRef.current = value;
    setPinState(value);
  };

  const press = async (key: string) => {
    if (busyRef.current) return;
    if (key === 'del') {
      setPin(pinRef.current.slice(0, -1));
      return;
    }
    if (!/^\d$/.test(key) || pinRef.current.length >= 4) return;
    const next = pinRef.current + key;
    setPin(next);
    setError(null);
    if (next.length === 4) {
      busyRef.current = true;
      const err = await completeRef.current(next);
      busyRef.current = false;
      setPin('');
      if (err) {
        setError(err);
        navigator.vibrate?.([30, 40, 30]);
      }
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^\d$/.test(e.key)) void press(e.key);
      else if (e.key === 'Backspace') void press('del');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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

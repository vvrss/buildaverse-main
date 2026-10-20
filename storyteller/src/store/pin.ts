/** PIN hashing for the profile lock. It keeps out casual access, nothing more. */

const toHex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');

export function newSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toHex(bytes.buffer);
}

export async function hashPin(pin: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  if (crypto.subtle) return toHex(await crypto.subtle.digest('SHA-256', data));
  // Insecure contexts have no SubtleCrypto; FNV-1a keeps the lock working there.
  let h = 0x811c9dc5;
  for (const b of data) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return `fnv:${h.toString(16)}`;
}

export async function makePin(pin: string) {
  const salt = newSalt();
  return { salt, hash: await hashPin(pin, salt) };
}

export async function checkPin(pin: string, stored: { salt: string; hash: string }): Promise<boolean> {
  return (await hashPin(pin, stored.salt)) === stored.hash;
}

export const isValidPin = (pin: string) => /^\d{4}$/.test(pin);

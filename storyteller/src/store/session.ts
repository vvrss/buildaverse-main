import { signal } from '@preact/signals';

/** Id of the profile currently signed in, or null on the welcome, picker and lock screens. */
export const profileId = signal<string | null>(null);

export function requireProfileId(): string {
  const id = profileId.value;
  if (!id) throw new Error('No profile is signed in');
  return id;
}

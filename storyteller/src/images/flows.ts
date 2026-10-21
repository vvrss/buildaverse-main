import { insertImage, showToast } from '../store/storyStore';
import { type Crop, type PictureKind, PictureError } from './compress';
import { cropPicture } from './CropSheet';
import { type Added, addPicture } from './pictures';

/**
 * Opens the system picture chooser. Must run inside a tap or key press.
 * Resolves null when the person cancels (where the browser reports it).
 */
export function pickImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    let done = false;
    const finish = (file: File | null) => {
      if (done) return;
      done = true;
      input.remove();
      resolve(file);
    };
    input.addEventListener('change', () => finish(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => finish(null));
    document.body.append(input);
    input.click();
  });
}

/** Compresses and stores a picture, with a toast for the outcome. Null when it failed. */
export async function storePicture(file: File, kind: PictureKind, crop?: Crop): Promise<Added | null> {
  try {
    return await addPicture(file, kind, crop);
  } catch (err) {
    showToast(err instanceof PictureError ? err.message : "That picture couldn't be added.");
    return null;
  }
}

/** Composer, /p, Alt+P and gestures: choose a picture and put it in the story where the composer is. */
export async function addPictureToStory(file?: File | null) {
  const chosen = file ?? (await pickImageFile());
  if (!chosen) return;
  const added = await storePicture(chosen, 'scene');
  if (!added) return;
  insertImage(added.ref);
  showToast(`Picture added · ${added.savings}`);
}

/** Picks, crops and stores a picture of a fixed shape; returns its code. */
async function chooseShaped(kind: 'portrait' | 'cover', aspect: number, title: string): Promise<string | null> {
  const file = await pickImageFile();
  if (!file) return null;
  const crop = await cropPicture(file, aspect, title);
  if (!crop) return null;
  const added = await storePicture(file, kind, crop);
  if (added) showToast(`${kind === 'portrait' ? 'Portrait' : 'Cover'} set · ${added.savings}`);
  return added?.ref ?? null;
}

export const choosePortrait = (name: string) => chooseShaped('portrait', 1, `Portrait of ${name}`);
export const chooseCover = () => chooseShaped('cover', 3 / 2, 'Cover');

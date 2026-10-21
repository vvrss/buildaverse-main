import { getPicture } from '../images/media';
import type { MediaInfo } from '../shared/api';
import { requireProfileId } from '../store/session';
import { ApiError, api, post } from './api';

/**
 * Sends this device's pictures to the server, skipping the ones it already
 * has. Safe to run again after an interruption: uploads are keyed by their
 * picture code. Throws when a picture is not on this device.
 */
export async function uploadPictures(refs: string[], onProgress?: (done: number, total: number) => void): Promise<void> {
  const unique = [...new Set(refs)];
  if (unique.length === 0) return;
  const owner = requireProfileId();
  const missing: string[] = [];
  for (let i = 0; i < unique.length; i += 200) {
    const r = await post<{ missing: string[] }>('/images/missing', { refs: unique.slice(i, i + 200) });
    missing.push(...r.missing);
  }
  const absent: string[] = [];
  let done = 0;
  onProgress?.(0, missing.length);
  for (const ref of missing) {
    const p = await getPicture(owner, ref);
    if (!p) {
      absent.push(ref);
      continue;
    }
    // One retry for a dropped connection; anything else is a real answer.
    for (let attempt = 0; ; attempt += 1) {
      try {
        await api<{ ref: string; media: MediaInfo }>('PUT', `/images/${ref}`, undefined, { raw: p.blob });
        break;
      } catch (err) {
        if (attempt === 0 && err instanceof ApiError && (err.code === 'offline' || err.status === 503)) {
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        throw err;
      }
    }
    done += 1;
    onProgress?.(done, missing.length);
  }
  if (absent.length) {
    throw new ApiError(422, 'pictures_not_here', `${absent.length === 1 ? 'A picture in this story is' : `${absent.length} pictures in this story are`} not on this device. Remove ${absent.length === 1 ? 'it' : 'them'} or add ${absent.length === 1 ? 'it' : 'them'} again.`, {
      code: 'pictures_not_here',
      message: '',
      refs: absent,
    });
  }
}

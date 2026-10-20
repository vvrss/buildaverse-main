/**
 * Getting files out of the app. A plain browser gets a normal download. When
 * the app runs inside a host that hands files over itself (such as the
 * claude.ai artifact viewer), that host's `downloads` capability is used.
 */

interface HostDownloads {
  save(request: { filename: string; data: string | Blob }): Promise<{ status: string }>;
}

interface HostWindow {
  claude?: { use(name: 'downloads'): Promise<HostDownloads | null> };
}

const host = (globalThis as unknown as HostWindow).claude;
const hostDownloads: Promise<HostDownloads | null> = host?.use ? host.use('downloads').catch(() => null) : Promise.resolve(null);

/** Extensions such hosts accept; anything else is saved with ".txt" added. */
const HOST_EXTENSIONS = ['txt', 'json', 'md', 'html', 'pdf', 'csv', 'zip'];

export type SaveOutcome = 'saved' | 'declined' | 'failed';

export async function saveFile(filename: string, data: string | Blob, mime = 'text/plain'): Promise<SaveOutcome> {
  const downloads = await hostDownloads;
  if (downloads) {
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    const name = HOST_EXTENSIONS.includes(ext) ? filename : `${filename}.txt`;
    try {
      await downloads.save({ filename: name, data });
      return 'saved';
    } catch (err) {
      return (err as { code?: string })?.code === 'declined' ? 'declined' : 'failed';
    }
  }
  try {
    const blob = data instanceof Blob ? data : new Blob([data], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return 'saved';
  } catch {
    return 'failed';
  }
}

/** True inside a host that saves files for us but cannot open a print dialog. */
export async function printIsUnavailable(): Promise<boolean> {
  return (await hostDownloads) !== null;
}

export type ShareOutcome = 'shared' | 'cancelled' | 'unsupported' | 'failed';

/**
 * Shares a file through the system share sheet where the device supports it.
 * Browsers only share well-known file types, so other names get ".txt".
 */
export async function shareFile(filename: string, data: string | Blob, mime = 'text/plain'): Promise<ShareOutcome> {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const name = ['txt', 'json', 'md', 'html', 'pdf', 'csv', 'png', 'jpg', 'jpeg', 'webp'].includes(ext) ? filename : `${filename}.txt`;
  try {
    const file = new File([data], name, { type: mime });
    if (!navigator.canShare?.({ files: [file] })) return 'unsupported';
    await navigator.share({ files: [file], title: name });
    return 'shared';
  } catch (err) {
    return (err as DOMException)?.name === 'AbortError' ? 'cancelled' : 'failed';
  }
}

export const canShareFiles = () => {
  try {
    return !!navigator.canShare?.({ files: [new File(['x'], 'x.txt', { type: 'text/plain' })] });
  } catch {
    return false;
  }
};

/** Prints an HTML document through a hidden frame, so the app's own layout is untouched. */
export function printHtml(html: string) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  frame.srcdoc = html;
  frame.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 1500);
  };
  document.body.appendChild(frame);
}

/** A file name from a title: keeps letters with their marks (Hindi, Thai...), digits, dots, - and _. */
export const safeFilename = (title: string) =>
  [
    ...title
      .normalize('NFC')
      .replace(/[^\p{L}\p{M}\p{N} ._-]+/gu, '')
      .replace(/^[.\s]+/, '')
      .replace(/\s+/g, ' ')
      .trim(),
  ]
    .slice(0, 80)
    .join('')
    .replace(/[.\s]+$/, '') || 'story';

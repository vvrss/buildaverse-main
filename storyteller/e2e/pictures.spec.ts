import { type Page, expect, test } from '@playwright/test';
import sharp from 'sharp';

/** Pictures on the device: compression, rotation, portraits, covers, captions and backups. */

async function signUp(page: Page, name = 'Ana') {
  await page.goto('/');
  await page.getByTestId('get-started').click();
  await page.getByTestId('profile-name').fill(name);
  await page.getByTestId('create-profile').click();
  await expect(page.locator('.home-head')).toContainText(name);
}

async function newStory(page: Page) {
  await page.getByTestId('new-story').click();
  await expect(page.getByTestId('composer')).toBeVisible();
}

async function send(page: Page, text: string) {
  const composer = page.getByTestId('composer');
  await composer.fill(text);
  await composer.press('Enter');
}

/** A 3000×2000 camera photo stored sideways (EXIF orientation 6), red on the left, with camera and GPS data. */
async function sidewaysPhoto(): Promise<Buffer> {
  const half = await sharp({ create: { width: 1500, height: 2000, channels: 3, background: '#d62828' } }).png().toBuffer();
  return sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#1d3dbf' } })
    .composite([{ input: half, left: 0, top: 0 }])
    .jpeg({ quality: 92 })
    .withMetadata({ orientation: 6, exif: { IFD0: { Make: 'TestCam' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '48/1 51/1 24/1' } } })
    .toBuffer();
}

const square = (color: string, size = 900) =>
  sharp({ create: { width: size, height: size, channels: 3, background: color } }).png().toBuffer();

/** Chooses `buffer` in the next file chooser that `open` triggers. */
async function choose(page: Page, open: () => Promise<void>, buffer: Buffer, name = 'photo.jpg', mimeType = 'image/jpeg') {
  const chooser = page.waitForEvent('filechooser');
  await open();
  await (await chooser).setFiles({ name, mimeType, buffer });
}

/** The pictures stored for this browser, read straight from IndexedDB. */
function storedPictures(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{ ref: string; width: number; height: number; type: string; size: number; exif: boolean; camera: boolean }[]>((resolve) => {
        const req = indexedDB.open('storyteller-media');
        req.onsuccess = () => {
          const all = req.result.transaction('pictures').objectStore('pictures').getAll();
          all.onsuccess = async () => {
            const out = [];
            for (const p of all.result as { ref: string; width: number; height: number; blob: Blob }[]) {
              const text = new TextDecoder('latin1').decode(new Uint8Array(await p.blob.arrayBuffer()));
              out.push({
                ref: p.ref,
                width: p.width,
                height: p.height,
                type: p.blob.type,
                size: p.blob.size,
                exif: text.includes('Exif'),
                camera: text.includes('TestCam'),
              });
            }
            req.result.close();
            resolve(out);
          };
        };
      }),
  );
}

test('a big sideways photo is shrunk, turned upright, stripped of its data and shown from the device', async ({ page }) => {
  await signUp(page);
  await newStory(page);
  await send(page, '> Before the picture.');
  const photo = await sidewaysPhoto();
  await choose(page, () => page.getByTestId('attach-picture').click(), photo);
  await expect(page.getByTestId('toast')).toContainText('Picture added');
  await expect(page.locator('.blk.image img')).toBeVisible();

  const [pic] = await storedPictures(page);
  // Upright: 2000×3000 becomes 1067×1600 (long side at most 1600 px).
  expect(pic.width).toBe(1067);
  expect(pic.height).toBe(1600);
  expect(pic.type).toMatch(/^image\/(webp|avif|jpeg)$/);
  expect(pic.size).toBeLessThan(photo.length);
  expect(pic.exif).toBe(false);
  expect(pic.camera).toBe(false);

  // Red is on top once the camera rotation is applied.
  const top = await page.locator('.blk.image img').evaluate((img: HTMLImageElement) => {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    return [...ctx.getImageData(Math.floor(c.width / 2), 10, 1, 1).data];
  });
  expect(top[0]).toBeGreaterThan(150);
  expect(top[2]).toBeLessThan(100);

  // The story text holds only the code; the picture comes from this device.
  await expect(page.locator('.blk.image img')).toHaveAttribute('src', /^blob:/);
  await page.getByRole('link', { name: 'Text' }).click();
  await expect(page.getByTestId('raw-text')).toHaveValue(new RegExp(`!\\[\\]\\(img:${pic.ref}\\)`));

  // Still there after a reload, with no network involved.
  await page.reload();
  await page.getByRole('link', { name: 'Write' }).click();
  await expect(page.locator('.blk.image img')).toHaveAttribute('src', /^blob:/);
});

test('/p adds a picture, and a caption can never turn it into dialog', async ({ page }) => {
  await signUp(page);
  await newStory(page);
  await send(page, '@ana Hello.');
  await choose(page, () => page.getByTestId('composer').pressSequentially('/p '), await square('#2a9d8f'), 'teal.png', 'image/png');
  await expect(page.locator('.blk.image')).toHaveCount(1);
  await page.locator('.blk.image').click();
  const composer = page.getByTestId('composer');
  await expect(composer).toHaveAttribute('placeholder', /Caption/);
  await composer.fill('@ana: not dialog');
  await composer.press('Enter');
  await expect(page.locator('.blk.image figcaption')).toHaveText('@ana: not dialog');
  await expect(page.locator('.blk.line')).toHaveCount(1);
});

test('portraits show beside bubbles, and covers on the Home card', async ({ page }) => {
  await signUp(page);
  await newStory(page);
  await send(page, '@ana Hi.');
  await send(page, '@tom Hey.');
  await page.getByRole('link', { name: 'Cast' }).click();
  await choose(page, () => page.getByRole('button', { name: 'Portrait for Ana' }).click(), await square('#e76f51'), 'ana.png', 'image/png');
  await expect(page.getByTestId('crop-frame')).toBeVisible();
  await page.getByTestId('crop-done').click();
  await expect(page.getByTestId('toast')).toContainText('Portrait set');
  await choose(page, () => page.getByTestId('add-cover').click(), await square('#8e5bd6', 1200), 'cover.png', 'image/png');
  await page.getByTestId('crop-done').click();
  await expect(page.locator('.cover-btn img')).toBeVisible();

  const pics = await storedPictures(page);
  expect(pics.map((p) => [p.width, p.height]).sort((a, b) => a[0] - b[0])).toEqual([
    [512, 512],
    [1200, 800],
  ]);

  await page.getByRole('link', { name: 'Write' }).click();
  await expect(page.locator('.blk.line.with-portrait .portrait img')).toHaveCount(1);
  await page.getByRole('button', { name: 'Back to stories' }).click();
  await expect(page.locator('.card .cover.photo img')).toBeVisible();
});

test('a backup can carry the pictures to another device', async ({ page, browser }) => {
  await signUp(page);
  await newStory(page);
  await send(page, '> A scene.');
  await choose(page, () => page.getByTestId('attach-picture').click(), await square('#3a86ff'), 'blue.png', 'image/png');
  await expect(page.locator('.blk.image img')).toBeVisible();
  await page.getByRole('button', { name: 'Back to stories' }).click();
  await expect(page.locator('.card')).toHaveCount(1);
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('switch', { name: 'Include pictures in the backup' })).toBeChecked();
  const download = page.waitForEvent('download');
  await page.getByText('Export full backup').click();
  const file = await (await download).path();
  const text = await import('node:fs').then((fs) => fs.readFileSync(file!, 'utf8'));
  const backup = JSON.parse(text);
  expect(backup.format).toBe(2);
  expect(backup.pictures).toHaveLength(1);

  const other = await browser.newContext();
  const page2 = await other.newPage();
  await signUp(page2, 'Tom');
  await page2.goto('/#/settings');
  await page2.getByTestId('restore-input').setInputFiles(file!);
  await page2.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page2.getByTestId('toast')).toContainText('1 pictures');
  await page2.goto('/');
  await page2.locator('.card-link').first().click();
  await expect(page2.locator('.blk.image img')).toHaveAttribute('src', /^blob:/);
  await other.close();
});

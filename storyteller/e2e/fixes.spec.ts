import { type Page, expect, test } from '@playwright/test';

/** Regression tests for the deep-review findings (numbers refer to the review list). */

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

const bubbles = (page: Page) => page.locator('.blk .bubble, .blk.narration').allInnerTexts();

/** Reads the stored story text straight from IndexedDB. */
async function storedTexts(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const req = indexedDB.open('storyteller');
        req.onsuccess = () => {
          const tx = req.result.transaction('stories');
          const all = tx.objectStore('stories').getAll();
          all.onsuccess = () => {
            resolve((all.result as { text: string }[]).map((r) => r.text));
            req.result.close();
          };
        };
      }),
  );
}

test('#3/#6 tapping another line keeps the edit you were making', async ({ page }) => {
  await signUp(page);
  await newStory(page);
  await send(page, '@ana First line.');
  await send(page, '@tom Second line.');
  await page.locator('.blk.line').first().click();
  await page.getByTestId('composer').fill('First line, edited.');
  await page.locator('.blk.line').nth(1).click();
  await expect(page.locator('.blk.line').first()).toContainText('First line, edited.');
});

test('#2 leaving the Text tab right after typing keeps the text', async ({ page }) => {
  await signUp(page);
  await newStory(page);
  await page.getByRole('link', { name: 'Text' }).click();
  const raw = page.getByTestId('raw-text');
  await raw.fill('---\ntitle: Pasted\n---\n\n> One.\n> Two.\n');
  await page.getByRole('link', { name: 'Write' }).click();
  await expect(page.locator('.blk.narration')).toHaveCount(2);
  await expect(page.locator('#story-title')).toHaveValue('Pasted');
});

test('#15/#17 "+ Below" and Text edits keep the unsent line', async ({ page }) => {
  await signUp(page);
  await newStory(page);
  await send(page, '@ana One.');
  await send(page, '@tom Two.');
  const composer = page.getByTestId('composer');
  await composer.fill('Half-written line');
  await page.locator('.blk.line').first().click();
  await page.getByRole('button', { name: 'Below' }).click();
  await send(page, 'Inserted.');
  await page.getByRole('button', { name: 'Jump to end' }).click();
  await expect(composer).toHaveValue('Half-written line');

  await page.getByRole('link', { name: 'Text' }).click();
  await page.getByTestId('raw-text').press('End');
  await page.getByTestId('raw-text').type('> Added in text.\n');
  await page.getByRole('link', { name: 'Write' }).click();
  await expect(page.locator('.blk.narration')).toContainText('Added in text.');
  await expect(composer).toHaveValue('Half-written line');
});

test('#33 reloading right after Enter keeps the last line', async ({ page }) => {
  await signUp(page);
  await newStory(page);
  await send(page, '> Last line before leaving');
  await page.reload();
  await expect(page.locator('.blk.narration')).toContainText('Last line before leaving');
});

test('#32 the phone back button shows a current Home', async ({ page }) => {
  await signUp(page);
  await newStory(page);
  await send(page, '@ana Hello.');
  await page.locator('#story-title').fill('Renamed');
  await page.goBack();
  await expect(page.locator('.card-title')).toHaveText('Renamed');
  await expect(page.locator('.card-meta')).toContainText('1 line');
});

test('#11 a stale window never overwrites a newer save', async ({ page, context }) => {
  await signUp(page);
  await newStory(page);
  await send(page, '> one');
  const url = page.url();
  const other = await context.newPage();
  await other.goto(url);
  await expect(other.locator('.blk.narration')).toHaveCount(1);
  await send(page, '> two from the first window');
  // The second window picks the save up instead of keeping its stale copy.
  await expect(other.locator('.blk.narration')).toHaveCount(2);
  await send(other, '> three from the second window');
  await page.waitForTimeout(800);
  const texts = await storedTexts(page);
  expect(texts.some((t) => t.includes('two from the first window') && t.includes('three from the second window'))).toBe(true);
});

test('#4/#9/#10 nothing of a profile shows after signing out', async ({ page }) => {
  await signUp(page, 'Ana');
  await newStory(page);
  await send(page, '@zorblax Secret character.');
  await page.goto('/#/account');
  await page.getByRole('button', { name: /Add a profile/ }).click();
  // #56: straight to the new-profile form.
  await page.getByTestId('profile-name').fill('Tom');
  await page.getByTestId('create-profile').click();
  await page.goto('/#/shortcuts');
  await expect(page.locator('.recorder select')).toBeVisible();
  await expect(page.locator('.recorder select')).not.toContainText('Zorblax');
});

test('#1 a blocked database upgrade waits instead of losing data', async ({ browser }) => {
  const context = await browser.newContext();
  const old = await context.newPage();
  await old.goto('/icon.svg');
  // An "old build" holding a version 1 connection open.
  await old.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const req = indexedDB.open('storyteller', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('stories', { keyPath: 'id' });
        req.onsuccess = () => {
          (window as unknown as { held: IDBDatabase }).held = req.result;
          resolve();
        };
      }),
  );
  const app = await context.newPage();
  await app.goto('/');
  await expect(app.getByText('Finishing an update')).toBeVisible();
  await old.close();
  await expect(app.getByTestId('get-started')).toBeVisible();
  await expect(app.getByText('Finishing an update')).toHaveCount(0);
  await context.close();
});

test('#27/#29 dialogs take focus, and delete confirmations focus Cancel', async ({ page }) => {
  await signUp(page);
  await page.getByRole('button', { name: 'Open sample' }).click();
  await expect(page.locator('.blk').first()).toBeVisible();
  await page.goto('/');
  await page.getByRole('button', { name: 'More for The Lighthouse' }).click();
  await expect(page.locator(':focus')).toHaveText(/Open/);
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator(':focus')).toHaveText('Cancel');
  await page.keyboard.press('Enter');
  await expect(page.locator('.card')).toHaveCount(1);
});

test('#45 the gesture pad closes when you leave the story', async ({ page }) => {
  await signUp(page);
  await newStory(page);
  await page.getByRole('button', { name: 'Gesture pad' }).click();
  await expect(page.getByTestId('gesture-pad')).toBeVisible();
  await page.goBack();
  await newStory(page);
  await expect(page.getByTestId('gesture-pad')).toHaveCount(0);
});

test('#28/#52/#55 nothing is cut off at 360 px with large text', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 360, height: 720 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await signUp(page);
  await page.goto('/#/settings');
  await page.getByRole('radio', { name: 'Large' }).click();
  await page.goto('/');
  await newStory(page);
  await send(page, '@ana One.');
  await send(page, '@tom Two.');
  await page.locator('.blk.line').first().click();
  for (const name of ['Stop editing', 'Delete', 'Gesture pad', 'Export story']) {
    const box = await page.getByRole('button', { name, exact: name !== 'Delete' }).first().boundingBox();
    expect(box, name).not.toBeNull();
    expect(box!.x + box!.width, name).toBeLessThanOrEqual(360);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await context.close();
});

test('#31 speaker chips work as buttons', async ({ page }) => {
  await signUp(page);
  await newStory(page);
  await send(page, '@ana One.');
  await send(page, '@tom Two.');
  await page.locator('.chip', { hasText: 'Tom' }).evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator('.chip.active')).toHaveText('Tom');
  void bubbles;
});

test('#12 the wrong-PIN lockout survives a reload', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('get-started').click();
  await page.getByTestId('profile-name').fill('Mira');
  await page.getByRole('switch', { name: 'Lock with a PIN' }).check();
  await page.getByTestId('create-profile').click();
  const type = async (pin: string) => {
    for (const d of pin) await page.locator('.pin-key', { hasText: d }).first().click();
  };
  await type('2468');
  await type('2468');
  await expect(page.locator('.home-head')).toContainText('Mira');
  await page.reload();
  for (let i = 0; i < 5; i += 1) await type('1111');
  await expect(page.locator('.pin-error')).toContainText('Wait 30 seconds');
  await page.reload();
  await type('2468');
  await expect(page.locator('.pin-error')).toContainText('Too many tries');
  await expect(page.locator('.home-head')).toHaveCount(0);
});

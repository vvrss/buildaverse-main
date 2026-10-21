import { type Page, expect, test } from '@playwright/test';

/** Reading stories line by line, like song lyrics. */

async function signUp(page: Page) {
  await page.goto('/');
  await page.getByTestId('get-started').click();
  await page.getByTestId('profile-name').fill('Ana');
  await page.getByTestId('create-profile').click();
  await expect(page.locator('.home-head')).toContainText('Ana');
}

async function importStory(page: Page, body: string) {
  const text = `---\ntitle: Night shift\ncharacters:\n  ana: Ana  #e76f51\n  tom: Tom  #2a9d8f\n---\n\n${body}\n`;
  await page.getByTestId('import-input').setInputFiles({ name: 'night.story', mimeType: 'text/plain', buffer: Buffer.from(text) });
  await expect(page.getByTestId('composer')).toBeVisible();
}

const lit = (page: Page) => page.getByTestId('reader-log').locator('[aria-current="true"]');

test('read your own story line by line: tap, keys, pace, and play to the end', async ({ page }) => {
  await signUp(page);
  await importStory(page, '> The wind howled.\n@ana: Did you hear that?\n@tom (whispering): Stay still.\n// a private note\n# Later\n@ana: Gone now.');
  await page.getByRole('link', { name: 'Read' }).click();
  const log = page.getByTestId('reader-log');
  await expect(log).toContainText('Did you hear that?');
  await expect(log).not.toContainText('a private note');
  await expect(log).toContainText('whispering');
  await expect(lit(page)).toContainText('The wind howled.');

  // It starts playing by itself; pause to go at your own speed.
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.getByTestId('ly-next').click();
  await expect(lit(page)).toContainText('Did you hear that?');
  await expect(log.locator('.ly-item').first()).toHaveClass(/past/);

  // Tapping the lit line moves on; tapping any other line jumps to it.
  await lit(page).click();
  await expect(lit(page)).toContainText('Stay still.');
  await log.getByText('The wind howled.').click();
  await expect(lit(page)).toContainText('The wind howled.');

  // Arrow keys step through the lines.
  await page.locator('body').press('ArrowDown');
  await expect(lit(page)).toContainText('Did you hear that?');
  await page.locator('body').press('ArrowUp');
  await expect(lit(page)).toContainText('The wind howled.');

  // The pace is remembered in Settings.
  await page.getByRole('button', { name: 'Pace: Calm. Change pace.' }).click();
  await expect(page.getByRole('button', { name: 'Pace: Quick. Change pace.' })).toBeVisible();

  // Playing lights each line in turn, then offers to read it again.
  await page.getByTestId('ly-play').click();
  await expect(lit(page)).toContainText('Did you hear that?', { timeout: 4000 });
  await expect(page.getByRole('button', { name: 'Read again' })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('The end')).toBeVisible();

  await page.getByRole('button', { name: 'Close reader' }).click();
  await expect(page.getByTestId('composer')).toBeVisible();
  await page.goto('/#/settings');
  await expect(page.getByRole('radio', { name: 'Quick' })).toHaveAttribute('aria-checked', 'true');
});

test('the lit line glides to the upper third, and scrolling by hand pauses and follows you', async ({ page }) => {
  await signUp(page);
  const lines = Array.from({ length: 40 }, (_, i) => `@${i % 2 ? 'tom' : 'ana'}: Line number ${i + 1}, a little longer so it wraps.`);
  await importStory(page, lines.join('\n'));
  await page.getByRole('link', { name: 'Read' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await page.getByRole('button', { name: 'Pause' }).click();

  const height = page.viewportSize()!.height;
  for (let i = 0; i < 6; i += 1) await page.getByTestId('ly-next').click();
  await expect(lit(page)).toHaveAttribute('data-i', '6');
  // Once the glide settles, the lit line rests about a third of the way down.
  await expect
    .poll(async () => Math.abs((await lit(page).boundingBox())!.y - height * 0.3), { timeout: 4000 })
    .toBeLessThan(24);

  await page.getByTestId('ly-play').click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await page.locator('.reading').evaluate((el) => el.scrollBy(0, 1400));
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  await expect.poll(async () => Number(await lit(page).getAttribute('data-i'))).toBeGreaterThan(12);
  const at = Number(await lit(page).getAttribute('data-i'));
  await page.getByTestId('ly-next').click();
  await expect(lit(page)).toHaveAttribute('data-i', String(at + 1));
});

test('the reader is reachable from the story menu on Home', async ({ page }) => {
  await signUp(page);
  await importStory(page, '@ana: Hello there.');
  await page.getByRole('button', { name: 'Back to stories' }).click();
  await page.getByRole('button', { name: 'More for Night shift' }).click();
  await page.getByText('Line by line, like lyrics').click();
  await expect(lit(page)).toContainText('Hello there.');
  // Closing goes back to where you came from.
  await page.keyboard.press('Escape');
  await expect(page.locator('.home-head')).toBeVisible();
});

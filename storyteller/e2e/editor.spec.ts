import { type Page, expect, test } from '@playwright/test';

async function signUp(page: Page, name = 'Ana', pin?: string) {
  await page.goto('/');
  await page.getByTestId('get-started').click();
  await page.getByTestId('profile-name').fill(name);
  if (pin) await page.getByRole('switch', { name: 'Lock with a PIN' }).check();
  await page.getByTestId('create-profile').click();
  if (pin) {
    await typePin(page, pin);
    await typePin(page, pin);
  }
  await expect(page.locator('.home-head')).toContainText(name);
}

async function typePin(page: Page, pin: string) {
  for (const d of pin) await page.locator('.pin-key', { hasText: d }).first().click();
}

async function newStory(page: Page) {
  await signUp(page);
  await page.getByTestId('new-story').click();
  await expect(page.getByTestId('composer')).toBeVisible();
}

async function send(page: Page, text: string) {
  const composer = page.getByTestId('composer');
  await composer.fill(text);
  await composer.press('Enter');
}

const activeChip = (page: Page) => page.locator('.chip.active');

/** Drags the mouse through a list of points, like a finger stroke. */
async function stroke(page: Page, points: [number, number][]) {
  await page.mouse.move(points[0][0], points[0][1]);
  await page.mouse.down();
  for (const [x, y] of points.slice(1)) await page.mouse.move(x, y, { steps: 8 });
  await page.mouse.up();
}

test('Enter alternates speakers without any switching', async ({ page }) => {
  await newStory(page);
  await send(page, '@ana Did you hear that?');
  await send(page, '@tom Stay still.');
  // From here on, only Enter: the speaker alternates by itself.
  await expect(activeChip(page)).toHaveText('Ana');
  await send(page, "It's coming from below.");
  await expect(activeChip(page)).toHaveText('Tom');
  await send(page, 'Nobody has been down there in years.');

  await page.getByRole('link', { name: 'Text' }).click();
  await expect(page.getByTestId('raw-text')).toHaveValue(
    [
      '---',
      'title: Untitled story',
      'characters:',
      '  ana: Ana  #e76f51',
      '  tom: Tom  #2a9d8f',
      '---',
      '',
      '@ana: Did you hear that?',
      '@tom: Stay still.',
      "@ana: It's coming from below.",
      '@tom: Nobody has been down there in years.',
      '',
    ].join('\n'),
  );
});

test('typed prefixes: narration, direction, @mention picker, /command', async ({ page }) => {
  await newStory(page);
  await send(page, '@ana Hi.');
  await send(page, '@tom Hey.');
  await send(page, '> Thunder rolls.');
  await send(page, '(whispering) Did you see that?');
  await expect(page.locator('.blk.narration')).toHaveText('Thunder rolls.');
  // After narration the turn goes to whoever answers the last line: Ana answers Tom.
  await expect(page.locator('.blk.line').last()).toContainText('Ana (whispering)');

  const composer = page.getByTestId('composer');
  await composer.fill('@t');
  await expect(page.locator('.suggestions li')).toHaveText(/Tom/);
  await composer.press('Enter');
  await expect(activeChip(page)).toHaveText('Tom');
  await expect(composer).toHaveValue('');

  await composer.fill('/u ');
  await expect(page.locator('.blk')).toHaveCount(3);
});

test('swiping the chip bar changes the speaker', async ({ page }) => {
  await newStory(page);
  await send(page, '@ana One.');
  await send(page, '@tom Two.');
  await send(page, '@mira Three.');
  await expect(activeChip(page)).toHaveText('Tom');

  const box = (await page.getByTestId('voice-chips').boundingBox())!;
  const y = box.y + box.height / 2;
  const x = box.x + box.width / 2;
  await stroke(page, [[x, y], [x - 60, y]]);
  await expect(activeChip(page)).toHaveText('Mira');
  await stroke(page, [[x, y], [x - 50, y], [x - 100, y]]);
  await expect(activeChip(page)).toHaveText('Ana');
  await stroke(page, [[x, y], [x + 60, y]]);
  await expect(activeChip(page)).toHaveText('Narration');
});

test('drawing < on the gesture pad goes back a line, > goes forward', async ({ page }) => {
  await newStory(page);
  await send(page, '@ana First.');
  await send(page, '@tom Second.');
  await page.getByRole('button', { name: 'Gesture pad' }).click();
  const pad = (await page.getByTestId('gesture-pad').boundingBox())!;
  const cx = pad.x + pad.width / 2;
  const cy = pad.y + pad.height / 2;

  await stroke(page, [[cx + 60, cy - 70], [cx - 60, cy], [cx + 60, cy + 70]]);
  await expect(page.getByTestId('toast')).toContainText('Previous line');
  await expect(page.locator('.banner')).toContainText('Editing line 2/2');

  await stroke(page, [[cx + 60, cy - 70], [cx - 60, cy], [cx + 60, cy + 70]]);
  await expect(page.locator('.banner')).toContainText('Editing line 1/2');
  await expect(page.getByTestId('composer')).toHaveValue('First.');

  await stroke(page, [[cx - 60, cy - 70], [cx + 60, cy], [cx - 60, cy + 70]]);
  await expect(page.locator('.banner')).toContainText('Editing line 2/2');
});

test('export, re-import and AI paste round-trip', async ({ page }) => {
  await signUp(page);
  await page.getByRole('button', { name: 'Open sample' }).click();
  await page.getByRole('link', { name: 'Text' }).click();
  const original = await page.getByTestId('raw-text').inputValue();
  expect(original).toContain('@tom (whispering): Stay still.');

  // Re-import as a new story: identical text.
  await page.goto('/');
  await page.locator('.toolbar input[type=file]').setInputFiles({ name: 'x.story', mimeType: 'text/plain', buffer: Buffer.from(original) });
  await page.getByRole('link', { name: 'Text' }).click();
  await expect(page.getByTestId('raw-text')).toHaveValue(original);

  // Paste an AI reply with chatter around the fenced story.
  await page.getByRole('link', { name: 'AI' }).click();
  const edited = original.replace('@ana: Did you hear that?', '@ana (gasping): Did you HEAR that?');
  await page.getByTestId('ai-reply').fill(`Sure! Here it is:\n\n\`\`\`story\n${edited}\`\`\`\nAnything else?`);
  await expect(page.getByTestId('diff-summary')).toContainText('+1 −1');
  await page.getByTestId('apply-ai').click();
  await expect(page.locator('.blk.line').first()).toContainText('Did you HEAR that?');

  // Undo brings the original back.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.blk.line').first()).toContainText('Did you hear that?');
});

test('stories persist across reloads', async ({ page }) => {
  await newStory(page);
  await send(page, '@ana Remember me.');
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.locator('.blk.line')).toContainText('Remember me.');
  await page.goto('/');
  await expect(page.locator('.card-title')).toHaveText('Untitled story');
});

test('a PIN locks the profile after a reload', async ({ page }) => {
  await signUp(page, 'Mira', '2468');
  await page.reload();
  await expect(page.locator('.lock')).toContainText('Mira');
  await typePin(page, '1111');
  await expect(page.locator('.pin-error')).toHaveText('Wrong PIN. Try again.');
  await typePin(page, '2468');
  await expect(page.locator('.home-head')).toContainText('Mira');
});

test('deleting a story asks first, on the page', async ({ page }) => {
  await signUp(page);
  await page.getByRole('button', { name: 'Open sample' }).click();
  await expect(page.locator('.blk').first()).toBeVisible();
  await page.goto('/');
  await page.getByRole('button', { name: 'More for The Lighthouse' }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('dialog', { name: 'Delete this story?' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete story' }).click();
  await expect(page.locator('.card')).toHaveCount(0);
  await expect(page.locator('.empty-home')).toBeVisible();
});

test('full backup restores stories into another profile', async ({ page }) => {
  await signUp(page);
  await page.getByRole('button', { name: 'Open sample' }).click();
  await expect(page.locator('.blk').first()).toBeVisible();
  await page.goto('/#/settings');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Export full backup/ }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^storyteller-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const file = await download.path();

  // A second profile starts empty, then gets the story from the backup.
  await page.goto('/#/account');
  // "Add a profile" opens the new-profile form directly.
  await page.getByRole('button', { name: /Add a profile/ }).click();
  await page.getByTestId('profile-name').fill('Tom');
  await page.getByTestId('create-profile').click();
  await expect(page.locator('.empty-home')).toBeVisible();

  await page.goto('/#/settings');
  await page.getByTestId('restore-input').setInputFiles(file!);
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.getByTestId('toast')).toContainText('Restored 1 story');
  await page.goto('/');
  await expect(page.locator('.card-title')).toHaveText('The Lighthouse');
});

test('theme setting switches to dark', async ({ page }) => {
  await signUp(page);
  await page.goto('/#/settings');
  await page.getByRole('radio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

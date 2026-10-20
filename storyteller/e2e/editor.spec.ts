import { type Page, expect, test } from '@playwright/test';

async function newStory(page: Page) {
  await page.goto('/');
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
  await page.goto('/');
  await page.getByRole('button', { name: 'Open sample' }).click();
  await page.getByRole('link', { name: 'Text' }).click();
  const original = await page.getByTestId('raw-text').inputValue();
  expect(original).toContain('@tom (whispering): Stay still.');

  // Re-import as a new story: identical text.
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({ name: 'x.story', mimeType: 'text/plain', buffer: Buffer.from(original) });
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
});

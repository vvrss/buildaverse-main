import { type Browser, type Page, expect, test } from '@playwright/test';
import sharp from 'sharp';
import { ADMIN } from '../playwright.config';

/** The Community, end to end against the real server: publish, read, update, social, moderation. */

let counter = 0;
const unique = (base: string) => `${base}${Date.now().toString(36).slice(-4)}${(counter += 1)}`;

async function signUp(page: Page, name = 'Ana') {
  await page.goto('/');
  await page.getByTestId('get-started').click();
  await page.getByTestId('profile-name').fill(name);
  await page.getByTestId('create-profile').click();
  await expect(page.locator('.home-head')).toContainText(name);
}

async function send(page: Page, text: string) {
  const composer = page.getByTestId('composer');
  await composer.fill(text);
  await composer.press('Enter');
}

/** Fills the account form (inline or in a sheet). */
async function account(page: Page, username: string, mode: 'create' | 'signin' = 'create', password = 'password-123') {
  if (mode === 'signin') await page.getByRole('tab', { name: 'Sign in' }).click();
  await page.getByTestId('account-username').fill(username);
  await page.getByTestId('account-password').fill(password);
  await page.getByTestId('account-submit').click();
}

async function joinCommunity(page: Page, username: string, mode: 'create' | 'signin' = 'create', password?: string) {
  await page.goto('/#/account');
  await page.getByText('Create an account or sign in').click();
  await account(page, username, mode, password);
  await expect(page.getByText(`@${username}`)).toBeVisible();
}

async function writeStory(page: Page, lines: string[], picture = false) {
  await page.goto('/');
  await page.getByTestId('new-story').click();
  for (const l of lines) await send(page, l);
  if (picture) {
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('attach-picture').click();
    const png = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#2a9d8f' } }).png().toBuffer();
    await (await chooser).setFiles({ name: 'scene.png', mimeType: 'image/png', buffer: png });
    await expect(page.locator('.blk.image img')).toBeVisible();
  }
}

async function publishOpenStory(page: Page, opts: { storyTitle?: string; episodeTitle?: string; target?: string } = {}) {
  await page.getByRole('button', { name: 'Export story' }).click();
  await page.getByText('Publish to Community…').click();
  await expect(page.getByTestId('publish-submit')).toBeVisible();
  if (opts.target) await page.getByTestId('publish-target').selectOption({ label: opts.target });
  if (opts.storyTitle) await page.getByTestId('publish-story-title').fill(opts.storyTitle);
  if (opts.episodeTitle) await page.getByTestId('publish-episode-title').fill(opts.episodeTitle);
  await page.getByTestId('publish-submit').click();
  await expect(page.getByTestId('publish-done')).toBeVisible();
  const url = await page.locator('.share-url code').innerText();
  return url.split('/e/')[1];
}

async function freshReader(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, isMobile: true, hasTouch: true });
  return { ctx, page: await ctx.newPage() };
}

test('publish an episode with a picture, then read it in a fresh browser without a profile', async ({ page, browser }) => {
  const writer = unique('ana');
  await signUp(page);
  await writeStory(page, ['@ana Did you hear that?', '@tom Stay still.', '// private note'], true);
  // Not signed in yet: the publish screen asks for an account first.
  await page.getByRole('button', { name: 'Export story' }).click();
  await page.getByText('Publish to Community…').click();
  await account(page, writer);
  await page.getByTestId('publish-story-title').fill('The Lighthouse');
  await page.getByTestId('publish-episode-title').fill('Storm');
  await expect(page.getByText('Your 1 note stays on this device.')).toBeVisible();
  await page.getByTestId('publish-submit').click();
  await expect(page.getByTestId('publish-done')).toContainText('Episode 1 is live');
  const episodeId = (await page.locator('.share-url code').innerText()).split('/e/')[1];

  // Home shows the story as published.
  await page.getByText('Back to the story').click();
  await page.getByRole('button', { name: 'Back to stories' }).click();
  await expect(page.locator('.card .badge')).toHaveText('Published · #1');

  const { ctx, page: reader } = await freshReader(browser);
  await reader.goto(`/#/c/e/${episodeId}`);
  await expect(reader.locator('.public-bar')).toBeVisible();
  await expect(reader.locator('.episode-head h1')).toHaveText('Storm');
  await expect(reader.getByTestId('reader-log')).toContainText('Did you hear that?');
  await expect(reader.getByTestId('reader-log')).not.toContainText('private note');
  await expect(reader.getByTestId('reader-log').locator('.ly-figure img')).toHaveAttribute('srcset', /\/media\/[0-9a-f]{64}\/\d+\.webp/);
  // Episodes read line by line: the first line is lit, the rest wait their turn.
  await expect(reader.getByTestId('reader-log').locator('[aria-current="true"]')).toHaveCount(1);
  await expect(reader.getByTestId('ly-play')).toBeVisible();
  // The link-preview page works without the app and sends people to it.
  const preview = await reader.request.get(`/e/${episodeId}`);
  expect(await preview.text()).toContain('<meta property="og:title" content="The Lighthouse · #1 Storm">');
  // Liking needs a profile: visitors are offered to join, and come back here after.
  await reader.getByTestId('like').click();
  await expect(reader.getByText('Join in')).toBeVisible();
  await reader.getByRole('button', { name: 'Get started' }).click();
  await reader.getByTestId('get-started').click();
  await reader.getByTestId('profile-name').fill('Reader');
  await reader.getByTestId('create-profile').click();
  await expect(reader.locator('.episode-head h1')).toHaveText('Storm');
  await ctx.close();
});

test('updating an episode, and choosing what to do when it changed elsewhere', async ({ page }) => {
  await signUp(page);
  await joinCommunity(page, unique('upd'));
  await writeStory(page, ['> First version.']);
  const episodeId = await publishOpenStory(page, { storyTitle: 'Updates', episodeTitle: 'One' });
  await page.getByText('Back to the story').click();
  await send(page, '> Added later.');
  await expect(page.getByRole('img', { name: 'Saved on this device' }).or(page.locator('[aria-label="Saved on this device"]'))).toHaveCount(1);
  await page.getByRole('button', { name: 'Export story' }).click();
  await page.getByText('Publish to Community…').click();
  await expect(page.getByText('Changed since')).toBeVisible();
  await page.getByTestId('publish-update').click();
  await expect(page.getByTestId('publish-done')).toContainText('Episode updated');

  // Someone (another device) updates it online meanwhile.
  const slotted = await page.evaluate(async (id) => {
    const res = await fetch(`/api/episodes/${id}`);
    return (await res.json()).revision as number;
  }, episodeId);
  expect(slotted).toBe(2);
  await page.evaluate(async ({ id }) => {
    const profiles = await new Promise<{ id: string }[]>((resolve) => {
      const req = indexedDB.open('storyteller');
      req.onsuccess = () => {
        const all = req.result.transaction('profiles').objectStore('profiles').getAll();
        all.onsuccess = () => resolve(all.result);
      };
    });
    const slot = profiles[0].id.replace(/-/g, '').slice(0, 16);
    await fetch(`/api/episodes/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-storyteller-slot': slot },
      body: JSON.stringify({ baseRevision: 2, text: '---\ntitle: One\n---\n\n> Changed on another device.\n' }),
    });
  }, { id: episodeId });

  await page.getByText('Back to the story').click();
  await send(page, '> My newest line.');
  await page.getByRole('button', { name: 'Export story' }).click();
  await page.getByText('Publish to Community…').click();
  await page.getByTestId('publish-update').click();
  await expect(page.getByText('Changed online')).toBeVisible();
  await page.getByText('Replace the online version').click();
  await expect(page.getByTestId('publish-done')).toContainText('Episode updated');
  const online = await page.evaluate(async (id) => (await (await fetch(`/api/episodes/${id}`)).json()).body as string, episodeId);
  expect(online).toContain('My newest line.');
  expect(online).not.toContain('another device');
});

test('readers like, follow and comment; the next episode reaches their feed and notifications', async ({ page, browser }) => {
  const writer = unique('wri');
  await signUp(page, 'Writer');
  await joinCommunity(page, writer);
  await writeStory(page, ['> Episode one.']);
  const first = await publishOpenStory(page, { storyTitle: 'Serial', episodeTitle: 'Part 1' });

  const { ctx, page: reader } = await freshReader(browser);
  await signUp(reader, 'Reader');
  await joinCommunity(reader, unique('rea'));
  await reader.goto(`/#/c/e/${first}`);
  await reader.getByTestId('like').click();
  await expect(reader.getByTestId('like')).toHaveAttribute('aria-pressed', 'true');
  await reader.getByRole('button', { name: 'Follow story' }).click();
  await expect(reader.getByRole('button', { name: 'Following' })).toBeVisible();
  await reader.getByTestId('comment-input').first().fill('Loved it!');
  await reader.getByTestId('comment-submit').first().click();
  await expect(reader.locator('.comment-body')).toHaveText('Loved it!');

  // The writer sees the reactions, replies, and writes episode 2 with "Write next episode".
  await page.goto('/#/c/notifications');
  await expect(page.locator('.notifications')).toContainText('liked');
  await expect(page.locator('.notifications')).toContainText('Loved it!');
  await page.goto(`/#/c/e/${first}`);
  await page.getByRole('button', { name: 'Reply' }).click();
  await page.getByPlaceholder(/Reply to/).fill('Thank you!');
  await page.getByRole('button', { name: 'Reply', exact: true }).last().click();
  await expect(page.locator('.replies .comment-body')).toHaveText('Thank you!');

  await page.goto('/');
  await page.locator('.card-link').first().click();
  await page.getByRole('button', { name: 'Export story' }).click();
  await page.getByText('Publish to Community…').click();
  await page.getByTestId('write-next').click();
  await send(page, '> Episode two.');
  await publishOpenStory(page, { episodeTitle: 'Part 2' });
  await expect(page.getByTestId('publish-done')).toContainText('Episode 2 is live');

  await reader.goto('/#/c/following');
  await expect(reader.locator('.feed-item').first()).toContainText('#2 Part 2');
  await expect(reader.getByRole('link', { name: /Community/ }).locator('.dot-badge')).toBeVisible();
  await reader.goto('/#/c/notifications');
  await expect(reader.locator('.notifications')).toContainText('replied to your comment');
  await expect(reader.locator('.notifications')).toContainText('New in “Serial”');
  // Home groups the writer's two episodes as a series.
  await page.goto('/');
  await expect(page.locator('.series-title')).toContainText('Serial');
  await ctx.close();
});

test('edit an episode on a second device, pictures included', async ({ page, browser }) => {
  const writer = unique('two');
  await signUp(page);
  await joinCommunity(page, writer);
  await writeStory(page, ['> With a picture.'], true);
  const episodeId = await publishOpenStory(page, { storyTitle: 'Two devices', episodeTitle: 'Here' });

  const { ctx, page: laptop } = await freshReader(browser);
  await signUp(laptop, 'Ana');
  await joinCommunity(laptop, writer, 'signin');
  await laptop.goto(`/#/c/e/${episodeId}`);
  await laptop.getByRole('button', { name: 'Edit this episode here' }).click();
  await expect(laptop.getByTestId('composer')).toBeVisible();
  await expect(laptop.locator('.log .blk.image img')).toHaveAttribute('src', /^blob:/);
  await expect(laptop.locator('#story-title')).toHaveValue('Here');
  await laptop.goto(`/#/c/e/${episodeId}`);
  await expect(laptop.getByRole('link', { name: 'Open your copy' })).toBeVisible();
  await ctx.close();
});

test('moderation: a report reaches the admin, who hides the episode and deletes the story', async ({ page, browser }) => {
  await signUp(page);
  await joinCommunity(page, unique('bad'));
  await writeStory(page, ['> Buy cheap things at example.com']);
  const episodeId = await publishOpenStory(page, { storyTitle: 'Spam story', episodeTitle: 'Ads' });

  const { ctx, page: reader } = await freshReader(browser);
  await signUp(reader, 'Reader');
  await joinCommunity(reader, unique('rep'));
  await reader.goto(`/#/c/e/${episodeId}`);
  await reader.locator('.page-foot').getByRole('button', { name: 'Report' }).click();
  await reader.getByText('Spam or advertising').click();
  await reader.getByRole('button', { name: 'Send report' }).click();
  await expect(reader.getByTestId('toast')).toContainText('moderator');

  const { ctx: adminCtx, page: admin } = await freshReader(browser);
  await signUp(admin, 'Admin');
  await joinCommunity(admin, ADMIN.username, 'signin', ADMIN.password);
  await admin.goto('/#/c/mod');
  await expect(admin.locator('.mod-item')).toContainText('Ads');
  await admin.getByRole('button', { name: 'Hide' }).click();
  await expect(admin.getByText('No open reports')).toBeVisible();
  await reader.reload();
  await expect(reader.getByRole('alert')).toContainText("doesn't exist");

  await admin.goto(`/#/c/e/${episodeId}`);
  await admin.locator('.reader-bar .reader-story').click();
  await admin.locator('.page-foot').getByRole('button', { name: 'Delete story' }).click();
  await admin.getByRole('button', { name: 'Delete story' }).last().click();
  await expect(admin.getByTestId('toast')).toContainText('Story deleted');
  await adminCtx.close();
  await ctx.close();
});

test('without a server, Community says so and everything else works', async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, contentType: 'text/html', body: '<h1>Not found</h1>' }));
  await signUp(page);
  await page.getByRole('link', { name: 'Community' }).click();
  await expect(page.getByText("Community isn't set up here")).toBeVisible();
  await writeStory(page, ['> Still works offline.']);
  await page.getByRole('button', { name: 'Export story' }).click();
  await expect(page.getByText('Publish to Community…')).toHaveCount(0);
});

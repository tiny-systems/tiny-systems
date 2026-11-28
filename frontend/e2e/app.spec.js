import { test, expect } from '@playwright/test';

test('the list shows the demo garden, and Needs you filters it', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#rows .row')).toHaveCount(6);
  await page.locator('#filters [data-filter=ask]').click();
  await expect(page.locator('#rows .row')).toHaveCount(1);
  await expect(page.locator('#rows .row')).toContainText('time zone');
});

test('answering a question with an option', async ({ page }) => {
  await page.goto('/?select=s-fern');
  const card = page.locator('.ask-card').first();
  await expect(card).toContainText('Pick one');
  await card.getByRole('button', { name: 'Pin to UTC' }).click();
  await expect(page.locator('.ask-card.answered')).toContainText('You answered Pin to UTC');
  await expect(page.locator('#rail-badge')).toBeHidden();
  await expect(page.locator('.msg, .text').filter({ hasText: 'Got it' }).first()).toBeVisible({ timeout: 5000 });
});

test('sending a message', async ({ page }) => {
  await page.goto('/?select=s-basil');
  const box = page.getByPlaceholder('Message Basil');
  await box.fill('Keep it friendly');
  await box.press('Enter');
  await expect(page.locator('#pane-body')).toContainText('Keep it friendly');
  await expect(page.locator('#pane-body')).toContainText('Noted', { timeout: 5000 });
});

test('starting a new helper', async ({ page }) => {
  await page.goto('/');
  await page.locator('#new-btn').click();
  await page.locator('#new-form textarea[name=task]').fill('Tidy the README');
  await page.getByRole('button', { name: 'Start helper' }).click();
  await expect(page.locator('#rows .row')).toHaveCount(7);
  await expect(page.locator('#rows')).toContainText('Tidy the README');
});

test('the terminal opens and echoes typing', async ({ page }) => {
  await page.goto('/?select=s-basil');
  await page.getByRole('tab', { name: 'Terminal' }).or(page.getByRole('button', { name: 'Terminal' })).first().click();
  await expect(page.locator('.xterm')).toContainText('Welcome to Claude Code', { timeout: 5000 });
  await page.locator('.xterm').click();
  await page.keyboard.type('hello');
  await page.keyboard.press('Enter');
  await expect(page.locator('.xterm')).toContainText('hello', { timeout: 5000 });
});

test('adding a garden asks for a Claude key when there is none to copy', async ({ page }) => {
  await page.goto('/');
  await page.locator('.rail-btn[data-view=gardens]').click();
  await page.locator('#add-garden').click();
  await page.locator('.place').first().click();
  await expect(page.locator('select[name=copyFrom]')).toHaveValue('paste');
  await expect(page.locator('input[name=token]')).toBeVisible();
  await page.locator('select[name=copyFrom]').selectOption('');
  await expect(page.locator('input[name=token]')).toBeHidden();
});

test('settings open from the help button', async ({ page }) => {
  await page.goto('/');
  await page.locator('#help').click();
  await page.locator('#menu').getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.locator('#wizard')).toContainText('Start this Mac’s gardens');
  await expect(page.locator('input[name=startVMs]')).toBeChecked();
});

test('a dialog closes from the dimmed area, asking first when something was typed', async ({ page }) => {
  await page.goto('/');
  const dlg = page.locator('#new-dialog');
  const confirm = page.locator('#confirm-dialog');
  // Empty: a click outside closes it straight away.
  await page.locator('#new-btn').click();
  await expect(dlg).toBeVisible();
  await page.mouse.click(8, 8);
  await expect(dlg).toBeHidden();
  // Typed: it asks; Keep editing keeps the text, Discard closes.
  await page.locator('#new-btn').click();
  await dlg.locator('textarea[name=task]').fill('Tidy the README');
  await page.mouse.click(8, 8);
  await expect(confirm).toContainText('Discard what you entered?');
  await confirm.getByRole('button', { name: 'Keep editing' }).click();
  await expect(dlg.locator('textarea[name=task]')).toHaveValue('Tidy the README');
  await page.keyboard.press('Escape');
  await confirm.getByRole('button', { name: 'Discard' }).click();
  await expect(dlg).toBeHidden();
});

test('each garden in the list has its own +, and a new helper shows its startup step', async ({ page }) => {
  await page.goto('/');
  const group = page.locator('#rows .group').first();
  await group.hover();
  await group.locator('.gadd').click();
  await expect(page.locator('#new-dialog')).toBeVisible();
  await page.locator('#new-form textarea[name=task]').fill('Tidy the README');
  await page.getByRole('button', { name: 'Start helper' }).click();
  await expect(page.locator('#pane .working')).toContainText('Waiting for a machine');
});

test('a file the helper showed appears in the chat and opens large', async ({ page }) => {
  await page.goto('/');
  await page.locator('#rows .row', { hasText: 'Juniper' }).click();
  const shot = page.locator('#pane .shown-img img');
  await expect(shot).toBeVisible();
  await shot.click();
  await expect(page.locator('#viewer')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#viewer')).toBeHidden();
});

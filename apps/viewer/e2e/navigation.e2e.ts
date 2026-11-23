// A library's own navigation in the sidebar. The fixture library's manifest
// has none (the folder tree, as ever); these specs serve it with
// fixtures/navigation/navigation.json as its `navigation`.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { seedTabs } from './dockHelpers';

const PREFIX = '/x/y/';
const NAVIGATION = fileURLToPath(new URL('./fixtures/navigation/navigation.json', import.meta.url));

test.describe.configure({ timeout: 15_000 });
test.use({ viewport: { width: 1200, height: 800 } });

const tree = (page: Page) => page.getByRole('navigation', { name: 'Screens' });
const item = (page: Page, name: string) => tree(page).getByRole('treeitem', { name, exact: true });
const row = (page: Page, name: string) => item(page, name).locator('> .nav-tree__row');
const screenRoot = (page: Page) =>
  page.locator('.viewer-canvas [data-testid="screen-root"]').locator('visible=true');
/** The labels of the Screens branch's rows, in order. */
const screenRows = (page: Page) =>
  tree(page)
    .locator('[data-branch="screens"] [role="treeitem"] > .nav-tree__row .nav-tree__label')
    .allTextContents();

/** Serve the manifest with `navigation` (the fixture file unless given). */
async function withNavigation(page: Page, navigation?: unknown) {
  const value = navigation ?? JSON.parse(await readFile(NAVIGATION, 'utf8'));
  await page.route(`**${PREFIX}drafts/manifest.json`, async (route) => {
    const response = await route.fetch();
    if (response.status() !== 200) return route.fulfill({ response });
    const manifest = (await response.json()) as Record<string, unknown>;
    await route.fulfill({ response, json: { ...manifest, navigation: value } });
  });
}

async function openWorkspace(page: Page) {
  await seedTabs(page, { keys: [], active: null });
  await page.goto(`${PREFIX}embed/`);
  await expect(tree(page).locator('[data-branch="screens"]')).toBeVisible();
}

test.describe('library navigation', () => {
  test("the Screens branch shows the library's tree, then All screens, collapsed @embed", async ({
    page,
  }) => {
    const warnings: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'warning') warnings.push(message.text());
    });
    await withNavigation(page);
    await openWorkspace(page);
    await expect(item(page, 'Screens')).toBeVisible();
    expect(await screenRows(page)).toEqual([
      'Start here',
      'Lines',
      'Beta C',
      'First of line A',
      'Operations',
      'Ops Panel',
      'Checks',
      'Label Fit',
      'All screens',
    ]);
    await expect(item(page, 'All screens')).toHaveAttribute('aria-expanded', 'false');
    // The id the library names without listing it: skipped, in one warning.
    await page.waitForTimeout(2_500); // two manifest polls later
    const named = warnings.filter((text) => text.includes('drafts/not-in-this-library'));
    expect(named).toHaveLength(1);
  });

  test('a leaf opens its screen; a group opens its own from the row and expands from the chevron @embed', async ({
    page,
  }) => {
    await withNavigation(page);
    await openWorkspace(page);
    await row(page, 'First of line A').click();
    await expect(page).toHaveURL(new RegExp(`${PREFIX}embed/lines/line-a/a$`));
    await expect(item(page, 'First of line A')).toHaveAttribute('aria-selected', 'true');

    await row(page, 'Lines').click();
    await expect(screenRoot(page)).toHaveAttribute('data-screen-id', 'wide-panel');
    await expect(item(page, 'Lines')).toHaveAttribute('aria-expanded', 'true');
    await row(page, 'Lines').getByTestId('nav-tree-chevron').click();
    await expect(item(page, 'Lines')).toHaveAttribute('aria-expanded', 'false');
    await expect(item(page, 'Beta C')).toHaveCount(0);
    await expect(screenRoot(page)).toHaveAttribute('data-screen-id', 'wide-panel');
  });

  test('All screens holds the folder tree; search finds a screen the navigation leaves out @embed', async ({
    page,
  }) => {
    await withNavigation(page);
    await openWorkspace(page);
    await expect(item(page, 'Macro Panel')).toHaveCount(0);
    await row(page, 'All screens').click();
    await expect(item(page, 'All screens')).toHaveAttribute('aria-expanded', 'true');
    for (const name of ['lines', 'ops', 'Macro Panel', 'E2E Panel']) {
      await expect(
        item(page, 'All screens').getByRole('treeitem', { name, exact: true })
      ).toBeVisible();
    }
    // Remembered across a reload.
    await page.reload();
    await expect(item(page, 'All screens')).toHaveAttribute('aria-expanded', 'true');
    await row(page, 'All screens').click();
    await expect(item(page, 'All screens')).toHaveAttribute('aria-expanded', 'false');

    await tree(page).getByRole('searchbox').fill('macro');
    expect(await screenRows(page)).toEqual(['All screens', 'Macro Panel']);
    await row(page, 'Macro Panel').click();
    await expect(screenRoot(page)).toHaveAttribute('data-screen-id', 'macro-panel');
  });

  test('a navigation leaf keeps its menu: Open in new tab @embed', async ({ page }) => {
    await withNavigation(page);
    await openWorkspace(page);
    await row(page, 'Start here').click();
    await expect(screenRoot(page)).toHaveAttribute('data-screen-id', 'e2e-panel');
    await row(page, 'Ops Panel').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Open in new tab' }).click();
    await expect(page.locator('[role="tab"][data-tab-key="ops/ops-panel"]')).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await expect(page.locator('[role="tab"][data-tab-key="drafts/e2e-panel"]')).toHaveCount(1);
  });

  test('an invalid navigation leaves the folder tree, with one warning @embed', async ({
    page,
  }) => {
    const warnings: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'warning') warnings.push(message.text());
    });
    await withNavigation(page, [{ label: 'Neither a screen nor a group' }]);
    await openWorkspace(page);
    await expect(item(page, 'All screens')).toHaveAttribute('aria-expanded', 'true');
    await expect(item(page, 'Screens')).toHaveCount(0);
    expect((await screenRows(page)).slice(0, 2)).toEqual(['lines', 'line-a']);
    await page.waitForTimeout(2_500);
    expect(warnings.filter((text) => text.includes("library's navigation"))).toHaveLength(1);
  });
});

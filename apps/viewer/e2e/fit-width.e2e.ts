// The three fit modes in a real browser: fit width (the default: the screen
// as wide as its pane, the rest scrolls down), fit page (the whole screen in
// view) and 100% (the drawn size). The tall panel is 600 x 1800, the E2E
// panel 400 x 200; the canvas keeps 16 px of padding on each side.

import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

const PREFIX = '/x/y/';
const TALL = `${PREFIX}embed/drafts/tall-panel`;
const PANEL = `${PREFIX}embed/drafts/e2e-panel`;
const PADDING = 16;

test.describe.configure({ timeout: 15_000 });
test.use({ viewport: { width: 1000, height: 600 } });

const root = (page: Page) => page.locator('.viewer-canvas [data-testid="screen-root"]');
const pane = (page: Page) => page.locator('main');
const percent = (page: Page) => page.getByTestId('zoom-percent');
const mode = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const width = async (page: Page) => (await root(page).boundingBox())!.width;

/** The pane's inner width, and whether its content overflows it each way. */
const paneBox = (page: Page) =>
  pane(page).evaluate((el) => ({
    inner: el.clientWidth,
    x: el.scrollWidth > el.clientWidth,
    y: el.scrollHeight > el.clientHeight,
    top: el.scrollTop,
  }));

async function open(page: Page, url: string) {
  await page.goto(url);
  await expect(root(page)).toBeVisible();
}

test.describe('fit modes', () => {
  test('a tall screen opens as wide as its pane and scrolls down, never sideways @embed', async ({
    page,
  }) => {
    await open(page, TALL);
    await expect(mode(page, 'Fit width')).toHaveAttribute('aria-pressed', 'true');
    const box = await paneBox(page);
    expect(Math.abs((await width(page)) - (box.inner - 2 * PADDING))).toBeLessThanOrEqual(1);
    expect(box).toMatchObject({ x: false, y: true, top: 0 });
    // The label matches the drawn scale, and the far end is reached by scrolling.
    expect(await percent(page).textContent()).toBe(
      `${Math.round(((box.inner - 2 * PADDING) / 600) * 100)}%`
    );
    await expect(page.getByText('Bottom edge', { exact: true })).not.toBeInViewport();
    await page.getByText('Bottom edge', { exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByText('Bottom edge', { exact: true })).toBeInViewport();
  });

  test('fit width follows the pane when it is resized @embed', async ({ page }) => {
    await open(page, TALL);
    for (const viewport of [700, 1300, 900]) {
      await page.setViewportSize({ width: viewport, height: 600 });
      await expect
        .poll(async () => {
          const box = await paneBox(page);
          return Math.abs((await width(page)) - (box.inner - 2 * PADDING));
        })
        .toBeLessThanOrEqual(1);
      expect((await paneBox(page)).x).toBe(false);
    }
  });

  test('the pane keeps its width whether or not the screen overflows it @embed', async ({
    page,
  }) => {
    // The same pane with a screen that scrolls and one that does not: a
    // scrollbar coming or going must not change the area the fit is taken from.
    await open(page, TALL);
    const scrolling = await paneBox(page);
    expect(scrolling.y).toBe(true);
    await mode(page, 'Fit page').click();
    await mode(page, 'Fit width').click();
    expect((await paneBox(page)).inner).toBe(scrolling.inner);
    await page.locator('[data-screen-key="drafts/e2e-panel"]').click();
    await expect(root(page)).toHaveAttribute('data-screen-id', 'e2e-panel');
    const still = await paneBox(page);
    expect(still.y).toBe(false);
    expect(still.inner).toBe(scrolling.inner);
  });

  test('fit page shows the whole screen; 100% is the drawn size @embed', async ({ page }) => {
    await open(page, TALL);
    await mode(page, 'Fit page').click();
    await expect(mode(page, 'Fit page')).toHaveAttribute('aria-pressed', 'true');
    await expect(mode(page, 'Fit width')).toHaveAttribute('aria-pressed', 'false');
    expect(await paneBox(page)).toMatchObject({ x: false, y: false });
    const fitted = (await root(page).boundingBox())!;
    expect(fitted.width / fitted.height).toBeCloseTo(600 / 1800, 2);
    await expect(page.getByText('Bottom edge', { exact: true })).toBeInViewport();

    await mode(page, '100%').click();
    await expect(mode(page, '100%')).toHaveAttribute('aria-pressed', 'true');
    await expect(percent(page)).toHaveText('100%');
    expect(Math.round(await width(page))).toBe(600);
    expect((await paneBox(page)).y).toBe(true);
  });

  test('the choice is remembered for the screen across a reload @embed', async ({ page }) => {
    await open(page, TALL);
    await mode(page, 'Fit page').click();
    await page.reload();
    await expect(root(page)).toBeVisible();
    await expect(mode(page, 'Fit page')).toHaveAttribute('aria-pressed', 'true');
    await mode(page, 'Fit width').click();
    await page.reload();
    await expect(root(page)).toBeVisible();
    await expect(mode(page, 'Fit width')).toHaveAttribute('aria-pressed', 'true');
  });

  test('a scrolled, scaled screen takes clicks and typing where its widgets are drawn @embed', async ({
    page,
  }) => {
    await open(page, TALL);
    const entry = root(page).locator('input').first();
    await entry.scrollIntoViewIfNeeded();
    await entry.click();
    await expect(entry).toBeFocused();
    await page.keyboard.type('12');
    await expect(entry).toHaveValue(/12/);
    await page.keyboard.press('Escape');
    // The link below it opens its screen, which starts at its top.
    await page.getByRole('button', { name: 'Open E2E Panel' }).click();
    await expect(root(page)).toHaveAttribute('data-screen-id', 'e2e-panel');
    expect((await paneBox(page)).top).toBe(0);
  });

  test('a screen opened from a scrolled one starts at its top @embed', async ({ page }) => {
    // A pane 250 px high: the E2E panel at fit width is taller than it.
    await page.setViewportSize({ width: 1000, height: 400 });
    await open(page, TALL);
    await page.getByRole('button', { name: 'Open E2E Panel' }).scrollIntoViewIfNeeded();
    expect((await paneBox(page)).top).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Open E2E Panel' }).click();
    await expect(root(page)).toHaveAttribute('data-screen-id', 'e2e-panel');
    const box = await paneBox(page);
    expect(box.y).toBe(true);
    expect(box.top).toBe(0);
  });

  test('export PNG holds the whole screen, not the part in view @embed', async ({ page }) => {
    // Wide enough for the header to show its actions in the bar.
    await page.setViewportSize({ width: 1400, height: 600 });
    await open(page, TALL);
    expect((await paneBox(page)).y).toBe(true);
    const shown = (await root(page).boundingBox())!;
    const ratio = await page.evaluate(() => window.devicePixelRatio);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-screen-action="export-png"]').click(),
    ]);
    const png = await readFile((await download.path())!);
    // IHDR: width and height, big-endian, at bytes 16 and 20.
    const [w, h] = [png.readUInt32BE(16), png.readUInt32BE(20)];
    expect(Math.abs(w - shown.width * ratio)).toBeLessThanOrEqual(2);
    expect(w / h).toBeCloseTo(600 / 1800, 2);
  });

  test('a narrow screen in a wide pane stops at 200%, centred @embed', async ({ page }) => {
    await page.setViewportSize({ width: 2000, height: 700 });
    await open(page, PANEL);
    await expect(percent(page)).toHaveText('200%');
    const box = (await root(page).boundingBox())!;
    expect(Math.round(box.width)).toBe(800);
    const outer = (await pane(page).boundingBox())!;
    const inner = (await paneBox(page)).inner;
    const left = box.x - outer.x;
    const right = inner - left - box.width;
    expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
  });
});

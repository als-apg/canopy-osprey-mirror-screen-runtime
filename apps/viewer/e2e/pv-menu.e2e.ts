// A PV's right-click menu in a browser: it opens on a widget that shows a PV,
// names the PV, and hands it to the data browser and the correlation plot.
// The fixture (plot-panel) has a readback and a setpoint entry.

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const PREFIX = '/x/y/';
const PANEL = `${PREFIX}embed/drafts/plot-panel`;
const CURRENT = 'E2E:PLOT:CURRENT';
const SETPOINT = 'E2E:PLOT:SETPOINT';

const widget = (page: Page, pv: string) => page.locator(`[data-pv="${pv}"]`).first();
const menu = (page: Page) => page.getByTestId('canopy-pv-menu');
const entry = (page: Page, name: string | RegExp) => menu(page).getByRole('menuitem', { name });

/** The query of the tool page whose URL holds `path`. */
async function toolQuery(page: Page, path: string): Promise<URLSearchParams> {
  const frame = page.locator(`iframe[src*="${path}"]`);
  await expect(frame).toBeVisible();
  return new URL((await frame.getAttribute('src')) ?? '', page.url()).searchParams;
}

test.describe('PV right-click menu', () => {
  test('names the PV and stays inside the window @trace', async ({ page }) => {
    await page.goto(PANEL);
    await widget(page, CURRENT).click({ button: 'right' });
    await expect(menu(page).getByTestId('canopy-pv-menu-head')).toContainText(CURRENT);
    const box = await menu(page).boundingBox();
    const view = page.viewportSize()!;
    expect(box!.x + box!.width).toBeLessThanOrEqual(view.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(view.height);
    await page.keyboard.press('Escape');
    await expect(menu(page)).toHaveCount(0);
  });

  test('plots a PV, then adds a second to the same plot @trace', async ({ page }) => {
    await page.goto(PANEL);
    await widget(page, CURRENT).click({ button: 'right' });
    await entry(page, 'Plot history').click();
    await expect(page).toHaveURL(new RegExp(`${PREFIX}embed/@trace$`));
    expect((await toolQuery(page, 'trace/')).getAll('pv')).toEqual([CURRENT]);

    await page.goto(PANEL);
    await widget(page, SETPOINT).click({ button: 'right' });
    await entry(page, 'Add to history plot').click();
    await expect(page).toHaveURL(new RegExp(`${PREFIX}embed/@trace$`));
    const query = await toolQuery(page, 'trace/');
    expect(query.getAll('pv')).toEqual([CURRENT, SETPOINT]);
    expect(query.get('range')).toBe('-1h');
  });

  test('picks an X on one PV and plots another against it @trace', async ({ page }) => {
    await page.goto(PANEL);
    await widget(page, CURRENT).click({ button: 'right' });
    await expect(entry(page, /Correlation: add as Y/)).toBeDisabled();
    await entry(page, /Correlation: use as X/).click();
    await expect(entry(page, /Correlation: use as X/)).toContainText('picked');
    await page.keyboard.press('Escape');

    await widget(page, SETPOINT).click({ button: 'right' });
    await expect(entry(page, /Correlation: plot against/)).toContainText(CURRENT);
    await entry(page, /Correlation: plot against/).click();
    const query = await toolQuery(page, 'correlation.html');
    expect(query.get('x')).toBe(CURRENT);
    expect(query.getAll('y')).toEqual([SETPOINT]);
  });
});

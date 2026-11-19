// Staged entries and Apply in the built viewer, over the mocked PV socket and
// a counted write route:
//
// - two values staged in two entries write nothing; an Apply that asks to
//   confirm opens one dialog listing each channel with its current value and
//   the value about to be written; Write sends both, one request per channel,
//   in the order staged, and the entries return to the live value;
// - Cancel sends nothing and both values stay staged.
//
// The deployment's own confirmWrites is off here, so the dialog is the one
// the Apply node asks for. The screen replaces the write-probe draft in
// transit: no fixture file.

import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { WRITABLE_PV, installHareMock, installPvWriteRoute } from './hostFixture';

test.describe.configure({ timeout: 30_000 });

const PREFIX = '/x/y';
const SCREEN = 'drafts/write-probe';
const FIRST = WRITABLE_PV;
const SECOND = 'PROBE:SECOND';

function node(id: string, type: string, props: Record<string, unknown>, x: number, y: number) {
  return { id, type, props, geometry: { x, y, width: 120, height: 30 } };
}

const STAGED_SCREEN = {
  schemaVersion: '1.0',
  kind: 'screen',
  id: 'write-probe',
  metadata: {
    title: 'Staged apply',
    source: { type: 'hand-authored' },
    size: { width: 420, height: 160 },
  },
  macros: [],
  root: {
    id: 'sa-root',
    type: 'absolute-canvas',
    props: { width: 420, height: 160 },
    geometry: { x: 0, y: 0, width: 420, height: 160 },
    children: [
      node('sa-first', 'pv-text-input', { pv: FIRST, stage: 'set' }, 10, 20),
      node('sa-second', 'pv-text-input', { pv: SECOND, stage: 'set' }, 10, 60),
      node(
        'sa-apply',
        'regular-button',
        {
          label: 'Apply',
          confirmWrites: true,
          actions: [{ type: 'apply_staged', scope: 'set' }],
        },
        150,
        20
      ),
    ],
  },
};

/** Hare mode with the deployment's confirmWrites off, the staged screen, and a counted write route. */
async function open(page: Page) {
  await installHareMock(page);
  // Registered after the mock's: this one answers config.json.
  await page.route('**/config.json', async (route) => {
    const response = await route.fetch();
    const config = (await response.json()) as Record<string, unknown>;
    await route.fulfill({ response, json: { ...config, pvMode: 'hare', confirmWrites: false } });
  });
  await page.route(`**/${SCREEN}.screen.json`, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: STAGED_SCREEN });
  });
  const writes = await installPvWriteRoute(page);
  await page.goto(`${PREFIX}/embed/${SCREEN}`);
  return writes;
}

const entry = (page: Page, id: string): Locator => page.locator(`[data-node-id="${id}"] input`);
const applyNode = (page: Page): Locator => page.locator('[data-node-id="sa-apply"]');
const staged = (page: Page): Locator => page.locator('[data-staged="true"]');
const dialog = (page: Page): Locator => page.getByTestId('canopy-write-dialog');

/** Types `text` into the entry and stages it with Enter. */
async function stage(page: Page, id: string, text: string): Promise<void> {
  const input = entry(page, id);
  await expect(input).toBeEnabled();
  await input.click();
  await input.fill(text);
  await input.press('Enter');
}

/** Stages 2.5 and 4 and opens the Apply dialog. */
async function stageBothAndApply(page: Page): Promise<void> {
  await expect(applyNode(page)).toHaveAttribute('aria-disabled', 'true');
  await stage(page, 'sa-first', '2.5');
  await stage(page, 'sa-second', '4');
  await expect(staged(page)).toHaveCount(2);
  await expect(applyNode(page)).toHaveAttribute('data-staged-count', '2');
  await expect(applyNode(page).getByTestId('canopy-staged-count')).toHaveText('2');
  await applyNode(page).getByRole('button', { name: 'Apply' }).click();
  await expect(dialog(page)).toBeVisible();
}

/** The dialog's rows as [channel, current, value]. */
async function rows(page: Page): Promise<string[][]> {
  return dialog(page)
    .locator('.canopy-write-dialog__writes tbody tr')
    .evaluateAll((trs) =>
      trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent ?? ''))
    );
}

test('two staged values: Apply asks once with current and new values, Write sends both', async ({
  page,
}) => {
  const writes = await open(page);
  await stageBothAndApply(page);
  expect(writes.count, 'nothing is written before the confirm').toBe(0);

  const listed = await rows(page);
  expect(listed.map((r) => r[0])).toEqual([FIRST, SECOND]);
  expect(listed.map((r) => r[2])).toEqual(['2.5', '4']);
  // The mocked socket serves 1 for every channel: a live value, not the dash.
  for (const row of listed) expect(Number.parseFloat(row[1])).toBe(1);

  await page.getByTestId('canopy-write-confirm').click();
  await expect.poll(() => writes.count).toBe(2);
  expect(writes.writes.map((w) => w.pv)).toEqual([FIRST, SECOND]);
  expect(writes.writes[0]).toMatchObject({ body: { value: 2.5 } });
  expect(writes.writes[1]).toMatchObject({ body: { value: 4 } });

  await expect(page.getByTestId('canopy-write-toast')).toHaveText('written');
  await expect(staged(page)).toHaveCount(0);
  await expect(applyNode(page)).toHaveAttribute('data-staged-count', '0');
  await expect(applyNode(page)).toHaveAttribute('aria-disabled', 'true');
  expect(writes.count, 'one request per channel').toBe(2);
});

test('Cancel in the Apply dialog writes nothing and keeps both values staged', async ({ page }) => {
  const writes = await open(page);
  await stageBothAndApply(page);
  await page.getByTestId('canopy-write-decline').click();
  await expect(dialog(page)).toHaveCount(0);

  await expect(staged(page)).toHaveCount(2);
  await expect(entry(page, 'sa-first')).toHaveValue('2.5');
  await expect(entry(page, 'sa-second')).toHaveValue('4');
  await expect(applyNode(page)).toHaveAttribute('data-staged-count', '2');
  await expect(applyNode(page)).not.toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('canopy-write-toast')).toHaveCount(0);
  expect(writes.count, 'PV write requests').toBe(0);
});

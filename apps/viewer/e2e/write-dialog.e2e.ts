// The write dialog in the built viewer, over the mocked PV socket and a
// counted write route: what it says for a press with consequences, a set
// point, two staged values and a channel that is not connected, and its keys.
//
// - The target is the dialog's first line; the title is a question; the
//   confirm button says the action.
// - A set point shows the unit, the step and the control limits the channel
//   states; a channel with no live value says "not connected".
// - Focus starts on Cancel. The Enter that opened the dialog (from an entry,
//   or from a focused button) does not answer it, held down or not; a second
//   Enter cancels; Escape cancels. None of them writes.
//
// The screen replaces the write-probe draft in transit: no fixture file.
//
// With WRITE_DIALOG_SHOTS set to a directory, each case also saves a picture
// of its dialog there.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { installHareMock, installPvWriteRoute } from './hostFixture';
import type { MockChannel } from './hostFixture';
import { heartbeat } from './machineFrames';

test.describe.configure({ timeout: 30_000 });

const PREFIX = '/x/y';
const SCREEN = 'drafts/write-probe';
const SHOTS = process.env.WRITE_DIALOG_SHOTS;

const REBOOT = 'RACK1:CTRL1:Reboot';
const SETPOINT = 'DEV:PS1:Setpoint';
const STAGED_SP = 'DEV:PS2:Setpoint';
const STAGED_RATE = 'DEV:PS2:RampRate';
const VALVE = 'DEV:VALVE1:Open';

const CHANNELS: Record<string, MockChannel> = {
  [REBOOT]: { value: 1, precision: 0 },
  [SETPOINT]: { value: 0.125, units: 'mrad', precision: 4, controlLow: -10, controlHigh: 10 },
  [STAGED_SP]: { value: 0.125, units: 'mrad', precision: 4 },
  [STAGED_RATE]: { value: 1, precision: 4 },
  [VALVE]: { connected: false },
};

function node(id: string, type: string, props: Record<string, unknown>, x: number, y: number) {
  return { id, type, props, geometry: { x, y, width: 140, height: 30 } };
}

const DIALOG_SCREEN = {
  schemaVersion: '1.0',
  kind: 'screen',
  id: 'write-probe',
  metadata: {
    title: 'Write dialog',
    source: { type: 'hand-authored' },
    size: { width: 520, height: 220 },
  },
  macros: [],
  root: {
    id: 'wd-root',
    type: 'absolute-canvas',
    props: { width: 520, height: 220 },
    geometry: { x: 0, y: 0, width: 520, height: 220 },
    children: [
      node(
        'wd-reboot',
        'pv-button',
        {
          pv: REBOOT,
          label: 'Reboot',
          pressValue: 0,
          confirmTitle: 'Reboot controller RACK1:CTRL1?',
          confirmText: 'It commands 2 power supplies. Their outputs are off until it is back.',
          confirmVerb: 'Reboot',
          confirmKind: 'consequence',
        },
        10,
        20
      ),
      node('wd-setpoint', 'pv-text-input', { pv: SETPOINT, label: 'corrector PS1' }, 10, 60),
      node('wd-staged-sp', 'pv-text-input', { pv: STAGED_SP, stage: 'set' }, 10, 100),
      node('wd-staged-rate', 'pv-text-input', { pv: STAGED_RATE, stage: 'set' }, 10, 140),
      node(
        'wd-apply',
        'regular-button',
        { label: 'Apply', actions: [{ type: 'apply_staged', scope: 'set' }] },
        170,
        100
      ),
      node('wd-valve', 'pv-button', { pv: VALVE, label: 'Open valve', pressValue: 1 }, 170, 20),
    ],
  },
};

/**
 * Hare mode (the deployment asks before every write), the dialog screen, a
 * counted write route. `notice`: what the target's heartbeat says of how it is
 * served.
 */
async function open(page: Page, notice: 'fallback' | null = null) {
  await installHareMock(page, {
    channels: CHANNELS,
    onOpen: () => heartbeat({ backend: 'sim', label: 'Simulator', binding: 'sim@1', notice }),
  });
  await page.route(`**/${SCREEN}.screen.json`, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: DIALOG_SCREEN });
  });
  const writes = await installPvWriteRoute(page);
  await page.goto(`${PREFIX}/embed/${SCREEN}`);
  return writes;
}

const dialog = (page: Page): Locator => page.getByTestId('canopy-write-dialog');
const title = (page: Page): Locator => page.getByTestId('canopy-write-title');
const cancel = (page: Page): Locator => page.getByTestId('canopy-write-decline');
const go = (page: Page): Locator => page.getByTestId('canopy-write-confirm');
const entry = (page: Page, id: string): Locator => page.locator(`[data-node-id="${id}"] input`);
const button = (page: Page, id: string): Locator => page.locator(`[data-node-id="${id}"] button`);

/** The labelled rows of a one-change dialog as [label, content]. */
async function rows(page: Page): Promise<string[][]> {
  return dialog(page)
    .locator('.canopy-write-dialog__row')
    .evaluateAll((all) =>
      all.map((row) => [
        row.querySelector('th')?.textContent ?? '',
        row.querySelector('td')?.textContent ?? '',
      ])
    );
}

/** Types `text` into the entry and presses Enter. */
async function enter(page: Page, id: string, text: string): Promise<void> {
  const input = entry(page, id);
  await expect(input).toBeEnabled();
  await input.click();
  await input.fill(text);
  await input.press('Enter');
}

/** With WRITE_DIALOG_SHOTS set: a picture of the open dialog. */
async function shoot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await dialog(page)
    .locator('.cds--modal-container')
    .screenshot({ path: join(SHOTS, `${name}.png`) });
}

test('a press with consequences: the screen words it, the button is the danger one', async ({
  page,
}) => {
  const writes = await open(page);
  await button(page, 'wd-reboot').click();
  await expect(dialog(page)).toBeVisible();

  const target = dialog(page).locator('.canopy-write-target');
  await expect(target).toHaveText('Simulator');
  await expect(dialog(page)).toHaveAttribute('data-target-kind', 'unknown');
  // The target is drawn above the title.
  const targetBox = (await target.boundingBox())!;
  const titleBox = (await title(page).boundingBox())!;
  expect(targetBox.y + targetBox.height).toBeLessThanOrEqual(titleBox.y + 1);

  await expect(title(page)).toHaveText('Reboot controller RACK1:CTRL1?');
  await expect(page.getByTestId('canopy-write-text')).toHaveText(
    'It commands 2 power supplies. Their outputs are off until it is back.'
  );
  await expect(dialog(page)).toHaveAttribute('data-kind', 'consequence');
  expect(await rows(page)).toEqual([
    ['channel', REBOOT],
    ['now', '1'],
    ['writes', '0'],
  ]);
  await expect(go(page)).toHaveText('Reboot');
  await expect(go(page)).toHaveClass(/cds--btn--danger/);
  await shoot(page, '1-consequence-press');
  expect(writes.count, 'nothing is written before the confirm').toBe(0);

  await go(page).click();
  await expect.poll(() => writes.count).toBe(1);
  expect(writes.writes[0]).toMatchObject({ pv: REBOOT, body: { value: 0 } });
});

test('a set point: a built title, the unit, the step and the limits; Cancel writes nothing', async ({
  page,
}) => {
  const writes = await open(page);
  await enter(page, 'wd-setpoint', '0.14');
  await expect(dialog(page)).toBeVisible();

  await expect(title(page)).toHaveText('Set corrector PS1 to 0.14 mrad?');
  expect(await rows(page)).toEqual([
    ['channel', SETPOINT],
    ['now', '0.1250 mrad'],
    ['writes', '0.14 mrad+0.0150'],
    ['limits', '-10 … 10 mrad'],
  ]);
  await expect(page.getByTestId('canopy-write-value')).toHaveText('0.14 mrad');
  await expect(go(page)).toHaveText('Set');
  await expect(go(page)).toHaveClass(/cds--btn--primary/);
  await shoot(page, '2-set-point');

  await cancel(page).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByTestId('canopy-write-toast')).toHaveCount(0);
  expect(writes.count, 'PV write requests').toBe(0);
});

test('two staged values: a table with "now" and "writes" in columns of their own', async ({
  page,
}) => {
  const writes = await open(page);
  await enter(page, 'wd-staged-sp', '0.14');
  await enter(page, 'wd-staged-rate', '0.5');
  await expect(page.locator('[data-staged="true"]')).toHaveCount(2);
  await page.locator('[data-node-id="wd-apply"]').getByRole('button', { name: 'Apply' }).click();
  await expect(dialog(page)).toBeVisible();

  await expect(title(page)).toHaveText('Apply 2 changes?');
  await expect(go(page)).toHaveText('Apply 2');
  const table = dialog(page).locator('table.canopy-write-dialog__columns');
  await expect(table.locator('th')).toHaveText(['channel', 'now', 'writes']);
  const cells = await table
    .locator('tbody tr')
    .evaluateAll((trs) =>
      trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent ?? ''))
    );
  expect(cells).toEqual([
    [STAGED_SP, '0.1250 mrad', '0.14 mrad'],
    [STAGED_RATE, '1.0000', '0.5'],
  ]);
  // Both value columns end at their column's right edge, one under the other.
  for (const column of [2, 3]) {
    const edges = await table
      .locator(`tbody td:nth-child(${column}) code`)
      .evaluateAll((all) => all.map((el) => Math.round(el.getBoundingClientRect().right)));
    expect(new Set(edges).size, `column ${column} is right-aligned`).toBe(1);
  }
  await shoot(page, '3-two-staged-values');
  expect(writes.count, 'nothing is written before the confirm').toBe(0);

  await go(page).click();
  await expect.poll(() => writes.count).toBe(2);
  expect(writes.writes.map((w) => w.pv)).toEqual([STAGED_SP, STAGED_RATE]);
});

test('a channel that is not connected: "now" says so', async ({ page }) => {
  const writes = await open(page);
  await button(page, 'wd-valve').click();
  await expect(dialog(page)).toBeVisible();

  await expect(title(page)).toHaveText('Open valve?');
  await expect(go(page)).toHaveText('Open valve');
  expect(await rows(page)).toEqual([
    ['channel', VALVE],
    ['now', 'not connected'],
    ['writes', '1'],
  ]);
  await expect(page.getByTestId('canopy-write-current')).toHaveAttribute('data-known', 'false');
  await shoot(page, '4-not-connected');

  await cancel(page).click();
  expect(writes.count, 'PV write requests').toBe(0);
});

test('a target served from the fallback says so on the first line', async ({ page }) => {
  const writes = await open(page, 'fallback');
  await button(page, 'wd-valve').click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).locator('.canopy-write-target')).toHaveText(
    'Simulator \u00b7 fallback (no target record)'
  );
  await expect(dialog(page)).toHaveAttribute('data-target-notice', 'fallback');
  await shoot(page, '5-fallback-target');
  await cancel(page).click();
  expect(writes.count, 'PV write requests').toBe(0);
});

test.describe('keys', () => {
  /** The dialog is still open, unanswered, after the key press has run its course. */
  async function staysOpen(page: Page): Promise<void> {
    await expect(dialog(page)).toBeVisible();
    await expect(cancel(page)).toBeFocused();
    await page.waitForTimeout(300);
    await expect(dialog(page)).toBeVisible();
  }

  test('the Enter that opens the dialog from an entry does not answer it; the next one cancels', async ({
    page,
  }) => {
    const writes = await open(page);
    await enter(page, 'wd-setpoint', '0.14');
    await staysOpen(page);
    expect(writes.count).toBe(0);

    await page.keyboard.press('Enter');
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByTestId('canopy-write-toast')).toHaveCount(0);
    expect(writes.count, 'Enter is Cancel: nothing written').toBe(0);
  });

  test('an Enter held down on the entry does not answer the dialog either', async ({ page }) => {
    const writes = await open(page);
    const input = entry(page, 'wd-setpoint');
    await expect(input).toBeEnabled();
    await input.click();
    await input.fill('0.14');
    await page.keyboard.down('Enter');
    await expect(dialog(page)).toBeVisible();
    await expect(cancel(page)).toBeFocused();
    // The key repeats while it is held.
    for (let i = 0; i < 5; i += 1) await page.keyboard.down('Enter');
    await page.keyboard.up('Enter');
    await staysOpen(page);
    expect(writes.count).toBe(0);
  });

  test('the Enter that opens the dialog from a focused button does not answer it', async ({
    page,
  }) => {
    const writes = await open(page);
    await button(page, 'wd-reboot').focus();
    await page.keyboard.press('Enter');
    await staysOpen(page);
    expect(writes.count).toBe(0);
  });

  test('Escape cancels; Tab reaches the confirm button, which Enter then presses', async ({
    page,
  }) => {
    const writes = await open(page);
    await button(page, 'wd-reboot').click();
    await expect(cancel(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    expect(writes.count).toBe(0);

    await button(page, 'wd-reboot').click();
    await expect(cancel(page)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(go(page)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(() => writes.count).toBe(1);
  });
});

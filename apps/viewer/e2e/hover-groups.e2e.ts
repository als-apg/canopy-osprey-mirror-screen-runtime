// Hover groups, beside the single areas of hover-areas.e2e.ts and
// shape-areas.e2e.ts. A coil is drawn as two polygons met on their shape, an
// ellipse and a row in a list: hovering any of them highlights all four, the
// second coil of the same circuit gets the lighter highlight, the rest of the
// drawing steps back, and one label shows, with live values served by fixture
// mode.

import { expect, test, type Page } from '@playwright/test';

const PREFIX = '/x/y/';
const SCREEN = 'drafts/hover-groups';
const KEY = 'coil';
const HOVER = '[data-canopy-hover]';
const LABEL = '[data-canopy-hover-label]';

const COIL_A = ['coil-a-upper', 'coil-a-lower', 'coil-a-lead', 'coil-a-row'];
const COIL_B = ['coil-b', 'coil-b-row'];
const REST = ['yoke', 'trim'];

const node = (id: string) => `[data-node-id="${id}"]`;

/** Open the screen in fixture mode: one channel live, one down, one not recorded. */
async function open(page: Page) {
  await page.route(`**${PREFIX}__fixture/${KEY}.json`, (route) =>
    route.fulfill({
      json: {
        timestamp: 1700000000,
        pvs: { 'DEV:1:Current': 12.3456, 'DEV:1:Field': { value: 1, connected: false } },
      },
    })
  );
  await page.goto(`${PREFIX}s/${SCREEN}?_canopyPv=fixture&_canopyFixture=${KEY}`);
  await expect(page.locator(node('coil-a-upper'))).toBeVisible();
  await page.mouse.move(2, 2);
}

/** Move the pointer to (x, y) in the coordinates of the polygon `id`. */
async function moveOnShape(page: Page, id: string, x: number, y: number) {
  const q = await page.locator(`${node(id)} [data-canopy-hit]`).evaluate(
    (el, p) => {
      const m = (el as SVGGraphicsElement).getScreenCTM()!;
      const at = new DOMPoint(p.x, p.y).matrixTransform(m);
      return { x: at.x, y: at.y };
    },
    { x, y }
  );
  await page.mouse.move(q.x, q.y);
}

/** Move the pointer to the middle of the box of node `id`. */
async function moveOver(page: Page, id: string) {
  const box = (await page.locator(node(id)).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}

const level = (page: Page, id: string) =>
  page.locator(`${node(id)} > ${HOVER}`).getAttribute('data-canopy-hover-level');

const opacity = (page: Page, id: string) =>
  page.locator(node(id)).evaluate((el) => Number(getComputedStyle(el).opacity));

/** Coil A is highlighted as one, coil B lightly, and nothing else. */
async function expectCoilA(page: Page, labels = 1) {
  await expect(page.locator(HOVER)).toHaveCount(COIL_A.length + COIL_B.length);
  for (const id of COIL_A) expect(await level(page, id), id).toBe('strong');
  for (const id of COIL_B) expect(await level(page, id), id).toBe('related');
  await expect(page.locator(LABEL)).toHaveCount(labels);
}

test.describe('hover groups', () => {
  test('hovering one part highlights the whole group, with one label', async ({ page }) => {
    await open(page);
    await expect(page.locator(HOVER)).toHaveCount(0);

    await moveOnShape(page, 'coil-a-upper', 80, 12);
    await expectCoilA(page);
    await expect(page.locator(LABEL)).toContainText('Coil A');
    // Each part is drawn in its own form: shapes, an ellipse, a box.
    await expect(page.locator(`${node('coil-a-lower')} > ${HOVER}`)).toHaveAttribute(
      'data-canopy-hover',
      'shape'
    );
    expect(
      await page
        .locator(`${node('coil-a-lead')} > ${HOVER}`)
        .evaluate((el) => getComputedStyle(el).borderTopLeftRadius)
    ).toBe('50%');
    // The row in the list is tinted: its layer paints a fill over the text's box.
    const tint = page.locator(`${node('coil-a-row')} [data-canopy-hover-fill]`);
    const row = (await page.locator(node('coil-a-row')).boundingBox())!;
    const painted = (await tint.boundingBox())!;
    expect(Math.abs(painted.width - row.width)).toBeLessThan(1);
    expect(await tint.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(
      'rgba(0, 0, 0, 0)'
    );
    // The related highlight is the lighter one.
    const strength = (id: string, inner: string) =>
      page
        .locator(`${node(id)} > ${HOVER}${inner}`)
        .evaluate((el) => Number(getComputedStyle(el).opacity));
    expect(await strength('coil-b', ' svg')).toBeLessThan(await strength('coil-a-lower', ' svg'));
    expect(await strength('coil-b-row', '')).toBeLessThan(await strength('coil-a-row', ''));

    // The corner of the upper coil's box that its shape leaves free is no area.
    await moveOnShape(page, 'coil-a-upper', 20, 50);
    await expect(page.locator(HOVER)).toHaveCount(0);
    await expect(page.locator(LABEL)).toHaveCount(0);
  });

  test('a row of the list and an ellipse hover the same group; the label is the hovered part’s', async ({
    page,
  }) => {
    await open(page);
    await moveOver(page, 'coil-a-row');
    await expectCoilA(page);
    await expect(page.locator(LABEL)).toHaveText('Coil A in the list');
    await expect(page.getByText('Main circuit')).toHaveCount(0);

    // The ellipse has no label of its own: the group is highlighted, no label shows.
    await moveOver(page, 'coil-a-lead');
    await expect(page.locator(HOVER)).toHaveCount(COIL_A.length + COIL_B.length);
    expect(await level(page, 'coil-a-upper')).toBe('strong');
    await expect(page.locator(LABEL)).toHaveCount(0);

    // From the other coil, the roles turn round.
    await moveOver(page, 'coil-b-row');
    for (const id of COIL_B) expect(await level(page, id), id).toBe('strong');
    for (const id of COIL_A) expect(await level(page, id), id).toBe('related');
    // Coil B's row has no label; the polygon's label belongs to the polygon.
    await expect(page.locator(LABEL)).toHaveCount(0);

    // A node without groups hovers nothing.
    await moveOver(page, 'legend');
    await expect(page.locator(HOVER)).toHaveCount(0);
  });

  test('the rest of the drawing steps back while a part is hovered', async ({ page }) => {
    await open(page);
    for (const id of [...REST, ...COIL_A, ...COIL_B, 'pump'])
      expect(await opacity(page, id)).toBe(1);

    // The lower coil has no label of its own.
    await moveOnShape(page, 'coil-a-lower', 50, 30);
    await expectCoilA(page, 0);
    for (const id of REST) {
      await expect(page.locator(node(id))).toHaveAttribute('data-canopy-hover-dimmed', '');
      expect(await opacity(page, id), id).toBeLessThan(0.6);
    }
    // Highlighted parts and another drawing keep their strength.
    for (const id of [...COIL_A, ...COIL_B, 'pump']) expect(await opacity(page, id), id).toBe(1);

    // A hover on the dimmed part itself: it is the group now, the coils step back.
    await moveOver(page, 'trim');
    expect(await level(page, 'trim')).toBe('strong');
    expect(await opacity(page, 'trim')).toBe(1);
    expect(await opacity(page, 'coil-b')).toBeLessThan(0.6);

    await page.mouse.move(2, 2);
    for (const id of [...REST, ...COIL_A, ...COIL_B]) expect(await opacity(page, id), id).toBe(1);
    await expect(page.locator('[data-canopy-hover-dimmed]')).toHaveCount(0);
  });

  test('the label shows live values, a channel that is down, and stays inside the screen', async ({
    page,
  }) => {
    await open(page);
    await moveOnShape(page, 'coil-a-upper', 80, 12);
    const label = page.locator(LABEL);
    await expect(label).toHaveCount(1);
    await expect(label.locator('[data-canopy-hover-line]')).toHaveText([
      'Main circuit',
      // The authored precision.
      'Current: 12.35',
      // Recorded as disconnected, and not recorded at all.
      'Field: ---',
      'Flow: ---',
    ]);
    await expect(label.locator('[data-pv="DEV:1:Field"]')).toHaveAttribute(
      'data-pv-nostate',
      'true'
    );
    await expect(label.locator('[data-pv="DEV:1:Current"]')).not.toHaveAttribute('data-pv-nostate');
    // The label's channels are not the node's own: no cue on the coil.
    await expect(page.locator(node('coil-a-upper'))).not.toHaveAttribute('data-pv');

    const screen = (await page.locator('[data-testid="screen-root"]').boundingBox())!;
    const box = (await label.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(screen.x);
    expect(box.y).toBeGreaterThanOrEqual(screen.y);
    expect(box.x + box.width).toBeLessThanOrEqual(screen.x + screen.width);
    expect(box.y + box.height).toBeLessThanOrEqual(screen.y + screen.height);
    // It lies over the parts drawn after its own: nothing covers its middle.
    const covered = await label.evaluate((el) => {
      const r = el.getBoundingClientRect();
      el.style.pointerEvents = 'auto';
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      el.style.pointerEvents = 'none';
      return top === null || !el.contains(top);
    });
    expect(covered).toBe(false);
  });

  test('a click on a member runs that member’s own actions', async ({ page }) => {
    await open(page);
    // The row carries no action: the click does nothing, the pointer is the default one.
    const row = page.locator(node('coil-a-row'));
    expect(await row.evaluate((el) => getComputedStyle(el).cursor)).not.toBe('pointer');
    await row.click();
    await expect(page.locator('[data-testid="screen-root"]')).toHaveAttribute(
      'data-screen-id',
      'hover-groups'
    );

    await moveOnShape(page, 'coil-a-lower', 50, 30);
    expect(
      await page
        .locator(`${node('coil-a-lower')} [data-canopy-hit]`)
        .evaluate((el) => getComputedStyle(el).cursor)
    ).toBe('pointer');
    await page.mouse.down();
    await page.mouse.up();
    await expect(page.locator('[data-testid="screen-root"]')).toHaveAttribute(
      'data-screen-id',
      'e2e-panel'
    );
  });
});

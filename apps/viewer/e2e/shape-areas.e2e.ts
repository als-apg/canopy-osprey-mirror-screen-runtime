// Clickable areas met on their drawn shape (`hitArea: 'shape'` on a polygon),
// beside the box areas of hover-areas.e2e.ts. Two bands along an arc share one
// bounding box; a bent line is met along its path; an L sits in a turned
// group and is turned itself. Every point is given in its node's own
// coordinates and mapped through the rendered transform, so the same checks
// run at each display mode.

import { expect, test, type Page } from '@playwright/test';

const PREFIX = '/x/y/';
const SCREEN = 'drafts/shape-areas';
const HOVER = '[data-canopy-hover]';

const node = (id: string) => `[data-node-id="${id}"]`;

/** The viewport point of (x, y) in the coordinates of node `id`. */
async function at(page: Page, id: string, x: number, y: number) {
  return page.locator(`${node(id)} [data-canopy-hit]`).evaluate(
    (el, p) => {
      const m = (el as SVGGraphicsElement).getScreenCTM()!;
      const q = new DOMPoint(p.x, p.y).matrixTransform(m);
      return { x: q.x, y: q.y };
    },
    { x, y }
  );
}

/** The point at `radius` and `degrees` round the bands' centre (270 = straight up). */
function onArc(radius: number, degrees: number) {
  const a = (degrees * Math.PI) / 180;
  return { x: 220 + radius * Math.cos(a), y: 220 + radius * Math.sin(a) };
}

async function moveTo(page: Page, id: string, p: { x: number; y: number }) {
  const q = await at(page, id, p.x, p.y);
  await page.mouse.move(q.x, q.y);
  return q;
}

const openScreen = (page: Page) => page.locator('[data-testid="screen-root"]');

async function expectNoHover(page: Page) {
  await expect(page.locator(HOVER)).toHaveCount(0);
  await expect(page.getByText(/^Open .* →$/)).toHaveCount(0);
}

/** Hovering `p` of node `id` highlights that node alone, with its one label. */
async function expectHover(page: Page, id: string, p: { x: number; y: number }, label: string) {
  await moveTo(page, id, p);
  await expect(page.locator(HOVER)).toHaveCount(1);
  await expect(page.locator(`${node(id)} ${HOVER}`)).toHaveAttribute('data-canopy-hover', 'shape');
  await expect(page.getByText(/^Open .* →$/)).toHaveCount(1);
  await expect(page.getByText(label)).toBeVisible();
}

/** The hover and miss checks of the two bands, at whatever zoom the page shows. */
async function checkBands(page: Page) {
  // Idle: nothing is highlighted, and the boxes take no pointer.
  await page.mouse.move(2, 2);
  await expectNoHover(page);
  for (const id of ['inner-band', 'outer-band']) {
    expect(await page.locator(node(id)).evaluate((el) => getComputedStyle(el).pointerEvents)).toBe(
      'none'
    );
  }

  await expectHover(page, 'outer-band', onArc(175, 270), 'Open E2E Panel →');
  // The label is centred in the band: the shape is what lies under its middle.
  const label = (await page.getByText('Open E2E Panel →').boundingBox())!;
  const centre = { x: label.x + label.width / 2, y: label.y + label.height / 2 };
  const under = await page.evaluate(
    (p) =>
      document.elementFromPoint(p.x, p.y)?.closest('[data-node-id]')?.getAttribute('data-node-id'),
    centre
  );
  expect(under).toBe('outer-band');
  const top = await at(page, 'outer-band', 220, 20);
  expect(Math.abs(centre.x - top.x)).toBeLessThan(label.width / 4);
  // The pointer shows a click is offered.
  expect(
    await page
      .locator(`${node('outer-band')} [data-canopy-hit]`)
      .evaluate((el) => getComputedStyle(el).cursor)
  ).toBe('pointer');

  // The inner band lies inside the outer one's box, under it: it is met itself.
  await expectHover(page, 'inner-band', onArc(115, 250), 'Open Label Fit →');
  // Its label is centred where its hoverLabelAt says, not at the band's middle.
  const placed = (await page.getByText('Open Label Fit →').boundingBox())!;
  const asked = await at(page, 'inner-band', 300, 140);
  expect(Math.abs(placed.x + placed.width / 2 - asked.x)).toBeLessThan(1.5);
  expect(Math.abs(placed.y + placed.height / 2 - asked.y)).toBeLessThan(1.5);
  // Between the bands, and under the arc: inside both boxes, on neither shape.
  await moveTo(page, 'outer-band', onArc(145, 270));
  await expectNoHover(page);
  await moveTo(page, 'outer-band', onArc(60, 270));
  await expectNoHover(page);
  // A corner of the shared box.
  await moveTo(page, 'outer-band', { x: 6, y: 6 });
  await expectNoHover(page);
  await moveTo(page, 'outer-band', { x: 434, y: 6 });
  await expectNoHover(page);
}

test.describe('areas met on their shape', () => {
  test('hover highlights the shape alone, with one label; its box corners are no area', async ({
    page,
  }) => {
    await page.goto(`${PREFIX}s/${SCREEN}`);
    await expect(page.locator(node('outer-band'))).toBeVisible();
    await checkBands(page);
  });

  test('a click in a box corner outside the shape does nothing', async ({ page }) => {
    await page.goto(`${PREFIX}s/${SCREEN}`);
    await expect(page.locator(node('outer-band'))).toBeVisible();
    for (const p of [{ x: 6, y: 6 }, { x: 434, y: 6 }, onArc(60, 270), onArc(145, 270)]) {
      const q = await at(page, 'outer-band', p.x, p.y);
      await page.mouse.click(q.x, q.y);
    }
    await expect(openScreen(page)).toHaveAttribute('data-screen-id', 'shape-areas');
    await expect(page).toHaveURL(new RegExp(`${PREFIX}s/${SCREEN}$`));
  });

  for (const [id, p, target] of [
    ['outer-band', onArc(175, 300), 'e2e-panel'],
    ['inner-band', onArc(115, 300), 'label-fit'],
  ] as const) {
    test(`neighbouring shapes in one box each open their own target (${id})`, async ({ page }) => {
      await page.goto(`${PREFIX}s/${SCREEN}`);
      await expect(page.locator(node(id))).toBeVisible();
      const q = await at(page, id, p.x, p.y);
      await page.mouse.click(q.x, q.y);
      await expect(openScreen(page)).toHaveAttribute('data-screen-id', target);
    });
  }

  test('an open line is met along its path at its hit width, not across its box', async ({
    page,
  }) => {
    await page.goto(`${PREFIX}s/${SCREEN}`);
    await expect(page.locator(node('bent-line'))).toBeVisible();
    // hitWidth 20 round a 3 px line: 8 px off the path is met, 13 px is not.
    await expectHover(page, 'bent-line', { x: 60, y: 8 }, 'Open Wide Panel →');
    await expectHover(page, 'bent-line', { x: 112, y: 70 }, 'Open Wide Panel →');
    // The label belongs on the bend, 30 px from the screen's edge: it is moved
    // in to show whole, and still covers the bend.
    const label = (await page.getByText('Open Wide Panel →').boundingBox())!;
    const screen = (await openScreen(page).boundingBox())!;
    expect(label.x + label.width).toBeLessThan(screen.x + screen.width);
    expect(label.y).toBeGreaterThan(screen.y);
    const bend = await at(page, 'bent-line', 120, 0);
    expect(bend.x).toBeGreaterThan(label.x);
    expect(bend.x).toBeLessThan(label.x + label.width);
    await moveTo(page, 'bent-line', { x: 60, y: 13 });
    await expectNoHover(page);
    // The middle of its box, and the corner the line does not pass.
    await moveTo(page, 'bent-line', { x: 60, y: 60 });
    await expectNoHover(page);
    await moveTo(page, 'bent-line', { x: 8, y: 112 });
    await expectNoHover(page);

    const q = await at(page, 'bent-line', 60, 60);
    await page.mouse.click(q.x, q.y);
    await expect(openScreen(page)).toHaveAttribute('data-screen-id', 'shape-areas');
    const on = await at(page, 'bent-line', 118, 100);
    await page.mouse.click(on.x, on.y);
    await expect(openScreen(page)).toHaveAttribute('data-screen-id', 'wide-panel');
  });

  test('a turned shape in a turned group is met where it is drawn; its label stays upright', async ({
    page,
  }) => {
    await page.goto(`${PREFIX}s/${SCREEN}`);
    await expect(page.locator(node('turned-shape'))).toBeVisible();
    // The L's upright and its foot are met; the notch between them is not.
    await expectHover(page, 'turned-shape', { x: 20, y: 40 }, 'Open Tall Panel →');
    const layer = page.locator(`${node('turned-shape')} ${HOVER}`);
    // The node is turned 45 degrees in all: the highlight turns with it...
    const turn = await layer.evaluate((el) => {
      const m = (el.querySelector('svg') as SVGGraphicsElement).getScreenCTM()!;
      return (Math.atan2(m.b, m.a) * 180) / Math.PI;
    });
    expect(turn).toBeCloseTo(45, 3);
    // ...and the label does not: its box is as flat as an upright chip's.
    const chip = page.getByText('Open Tall Panel →');
    const drawn = (await chip.boundingBox())!;
    const flat = await chip.evaluate((el) => ({
      width: (el as HTMLElement).offsetWidth,
      height: (el as HTMLElement).offsetHeight,
    }));
    const scale = drawn.width / flat.width;
    expect(drawn.height / scale).toBeCloseTo(flat.height, 0);
    expect(drawn.width).toBeGreaterThan(drawn.height * 3);

    await expectHover(page, 'turned-shape', { x: 100, y: 100 }, 'Open Tall Panel →');
    await moveTo(page, 'turned-shape', { x: 80, y: 40 });
    await expectNoHover(page);

    const q = await at(page, 'turned-shape', 80, 40);
    await page.mouse.click(q.x, q.y);
    await expect(openScreen(page)).toHaveAttribute('data-screen-id', 'shape-areas');
    const on = await at(page, 'turned-shape', 100, 100);
    await page.mouse.click(on.x, on.y);
    await expect(openScreen(page)).toHaveAttribute('data-screen-id', 'tall-panel');
  });

  test('the frame without a header meets the same shapes', async ({ page }) => {
    await page.goto(`${PREFIX}embed/${SCREEN}?_canopyChrome=0`);
    await expect(page.locator(node('outer-band'))).toBeVisible();
    await expect(page.locator('header')).toHaveCount(0);
    await checkBands(page);
    const q = await at(page, 'inner-band', 220, 105);
    await page.mouse.click(q.x, q.y);
    await expect(openScreen(page)).toHaveAttribute('data-screen-id', 'label-fit');
  });
});

test.describe('areas met on their shape, by touch', () => {
  test.use({ hasTouch: true });

  test('a tap on the shape opens its target; a tap in its box corner does not', async ({
    page,
  }) => {
    await page.goto(`${PREFIX}s/${SCREEN}`);
    await expect(page.locator(node('outer-band'))).toBeVisible();
    const corner = await at(page, 'outer-band', 6, 6);
    await page.touchscreen.tap(corner.x, corner.y);
    const between = await at(page, 'outer-band', 220, 75);
    await page.touchscreen.tap(between.x, between.y);
    await expect(openScreen(page)).toHaveAttribute('data-screen-id', 'shape-areas');
    const on = await at(page, 'inner-band', 220, 105);
    await page.touchscreen.tap(on.x, on.y);
    await expect(openScreen(page)).toHaveAttribute('data-screen-id', 'label-fit');
  });
});

test.describe('areas met on their shape, at every display mode', () => {
  test.use({ viewport: { width: 2400, height: 1300 } });

  test('hit testing and the label follow Fit width, Fit page and 100%', async ({ page }) => {
    await page.goto(`${PREFIX}embed/${SCREEN}`);
    await expect(page.locator(node('outer-band'))).toBeVisible();
    const percent = page.getByTestId('zoom-percent');
    const width = async () => Math.round((await openScreen(page).boundingBox())!.width);

    // Fit width stops at 200%.
    await expect(page.getByRole('button', { name: 'Fit width', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(percent).toHaveText('200%');
    await checkBands(page);

    await page.getByRole('button', { name: 'Fit page', exact: true }).click();
    await expect.poll(width).toBeGreaterThan(1500);
    await checkBands(page);

    await page.getByRole('button', { name: '100%', exact: true }).click();
    await expect(percent).toHaveText('100%');
    await expect.poll(width).toBe(640);
    await checkBands(page);

    const q = await at(page, 'outer-band', 220, 45);
    await page.mouse.click(q.x, q.y);
    await expect(openScreen(page)).toHaveAttribute('data-screen-id', 'e2e-panel');
  });
});

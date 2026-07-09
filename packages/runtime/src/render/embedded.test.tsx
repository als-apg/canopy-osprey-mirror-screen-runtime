// Embedded screens: resolution, macro layering, depth limit, cycle guard,
// schema gating, and failure containment.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MockPVService } from '@slaclab/canopy-client';
import { PVServiceProvider } from '@slaclab/canopy-react';
import { registerBuiltinWidgets } from '@slaclab/canopy-screen-widgets';
import type { PropertyValue, ScreenJSON } from '@slaclab/canopy-screen-ir';
import { ScreenRenderer } from './ScreenRenderer.js';

let service: MockPVService;

beforeAll(() => {
  registerBuiltinWidgets();
});

beforeEach(() => {
  service = new MockPVService();
  service.connect();
});

afterEach(() => {
  cleanup();
  service.disconnect();
});

function wrap(children: ReactNode) {
  return <PVServiceProvider service={service}>{children}</PVServiceProvider>;
}

function host(embedProps: Record<string, PropertyValue>): ScreenJSON {
  return {
    schemaVersion: '1.0',
    kind: 'screen',
    id: 'host',
    metadata: {
      title: 'host',
      source: { type: 'hand-authored' },
      size: { width: 400, height: 300 },
    },
    macros: [{ name: 'P', default: 'TOP' }],
    root: {
      id: 'h-root',
      type: 'absolute-canvas',
      props: {},
      geometry: { x: 0, y: 0, width: 400, height: 300 },
      children: [
        {
          id: 'h-embed',
          type: 'embedded-display',
          props: embedProps,
          geometry: { x: 10, y: 10, width: 300, height: 200 },
        },
      ],
    },
  };
}

function leaf(id: string, text: string, macroName?: string): ScreenJSON {
  return {
    schemaVersion: '1.0',
    kind: 'screen',
    id,
    metadata: { title: id, source: { type: 'hand-authored' }, size: { width: 100, height: 50 } },
    macros: macroName ? [{ name: macroName, default: 'child-default' }] : [],
    root: {
      id: `${id}-root`,
      type: 'text-label',
      props: { text },
      geometry: { x: 0, y: 0, width: 100, height: 20 },
    },
  };
}

describe('embedded screens', () => {
  it('layers macros: child defaults < parent macros < node overrides', async () => {
    // The child declares M with a default; the node overrides it with a value
    // that itself references the parent macro P.
    const child = leaf('leaf', '${M}|${P}', 'M');
    const resolveScreen = vi.fn().mockResolvedValue(child);

    render(
      wrap(
        <ScreenRenderer
          screen={host({ file: 'leaf.screen.json', macros: { M: '${P}:sub' } })}
          resolveScreen={resolveScreen}
        />
      )
    );

    // M: node override "${P}:sub" resolved against parent → TOP:sub
    // P: inherited from the parent wholesale.
    expect(await screen.findByText('TOP:sub|TOP')).toBeTruthy();
  });

  it('falls back to child declared defaults when nothing provides the macro', async () => {
    const child = leaf('leaf', '${M}', 'M');
    const resolveScreen = vi.fn().mockResolvedValue(child);

    render(
      wrap(
        <ScreenRenderer screen={host({ file: 'leaf.screen.json' })} resolveScreen={resolveScreen} />
      )
    );

    expect(await screen.findByText('child-default')).toBeTruthy();
  });

  it('shows an error box when resolveScreen is missing', () => {
    render(wrap(<ScreenRenderer screen={host({ file: 'leaf.screen.json' })} />));
    expect(screen.getByTestId('widget-error').textContent).toContain('no resolveScreen');
  });

  it('shows an error box when the file prop is missing', () => {
    render(wrap(<ScreenRenderer screen={host({})} resolveScreen={vi.fn()} />));
    expect(screen.getByTestId('widget-error').textContent).toContain("missing 'file'");
  });

  it('shows an error box when resolution fails', async () => {
    const resolveScreen = vi.fn().mockRejectedValue(new Error('404 not found'));
    render(
      wrap(
        <ScreenRenderer screen={host({ file: 'gone.screen.json' })} resolveScreen={resolveScreen} />
      )
    );
    const box = await screen.findByTestId('widget-error');
    expect(box.textContent).toContain('404 not found');
  });

  it('gates embedded documents on schemaVersion', async () => {
    const wrong = { ...leaf('leaf', 'x'), schemaVersion: '9.9' } as unknown as ScreenJSON;
    const resolveScreen = vi.fn().mockResolvedValue(wrong);
    render(
      wrap(
        <ScreenRenderer screen={host({ file: 'leaf.screen.json' })} resolveScreen={resolveScreen} />
      )
    );
    const box = await screen.findByTestId('widget-error');
    expect(box.textContent).toContain('Schema version mismatch');
  });

  it('detects embedding cycles by screen ref', async () => {
    // host embeds a.screen.json; a embeds a.screen.json again → cycle box.
    const selfEmbedding: ScreenJSON = {
      ...host({ file: 'a.screen.json' }),
      id: 'a',
    };
    const resolveScreen = vi.fn().mockResolvedValue(selfEmbedding);

    render(
      wrap(
        <ScreenRenderer screen={host({ file: 'a.screen.json' })} resolveScreen={resolveScreen} />
      )
    );

    const box = await screen.findByTestId('widget-error');
    expect(box.textContent).toContain('cycle');
    // Only the first level resolved; the second was refused.
    expect(resolveScreen).toHaveBeenCalledTimes(1);
  });

  it('enforces the depth limit on non-cyclic chains', async () => {
    // Each level embeds a uniquely-named next level — no ref cycle, so only
    // the depth cap stops it.
    let n = 0;
    const resolveScreen = vi.fn().mockImplementation((ref: string) => {
      n += 1;
      return Promise.resolve({
        ...host({ file: `level-${n}.screen.json` }),
        id: `screen-${ref}`,
      });
    });

    render(
      wrap(
        <ScreenRenderer
          screen={host({ file: 'level-0.screen.json' })}
          resolveScreen={resolveScreen}
          maxDepth={3}
        />
      )
    );

    const box = await screen.findByTestId('widget-error');
    expect(box.textContent).toContain('depth limit 3');
    expect(resolveScreen).toHaveBeenCalledTimes(3);
  });
});

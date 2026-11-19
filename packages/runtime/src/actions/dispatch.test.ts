// Action dispatch: every Action variant routed to the injected callbacks, in
// declaration order, with no viewer in the loop.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Action } from '@slaclab/canopy-screen-ir';
import type {
  WriteGateService,
  WriteOutcome,
  WriteOutcomeKind,
  WriteRequest,
} from '@slaclab/canopy-screen-widgets';
import { createStagingStore } from '@slaclab/canopy-screen-widgets';
import {
  dispatchActions,
  isOpenableUrl,
  resetActionWarnings,
  type ActionContext,
} from './dispatch.js';

const EXECUTE_NOT_AVAILABLE = "'execute' actions are not available here";

function makeCtx(overrides: Partial<ActionContext> = {}): ActionContext & {
  calls: string[];
} {
  const calls: string[] = [];
  const ctx: ActionContext & { calls: string[] } = {
    calls,
    macros: { P: 'LI21', DEV: 'M1' },
    pvService: {
      put: vi.fn((pv: string, value: string | number) => {
        calls.push(`put ${pv}=${value}`);
      }),
    },
    resolveManifest: vi.fn((file: string) => `/screens/${file.replace(/\.bob$/, '')}`),
    navigate: vi.fn((url: string) => {
      calls.push(`navigate ${url}`);
    }),
    openWindow: vi.fn((url: string) => {
      calls.push(`openWindow ${url}`);
    }),
    close: vi.fn(() => {
      calls.push('close');
    }),
    showError: vi.fn((msg: string) => {
      calls.push(`error ${msg}`);
    }),
    ...overrides,
  };
  return ctx;
}

describe('dispatchActions', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetActionWarnings();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('writes two write_pv entries in order with macro-substituted PV names', async () => {
    const ctx = makeCtx();
    const actions: Action[] = [
      { type: 'write_pv', pvName: '${P}:A', value: 1 },
      { type: 'write_pv', pvName: '$(P):B', value: 'on' },
    ];
    await dispatchActions(actions, ctx);
    expect(ctx.calls).toEqual(['put LI21:A=1', 'put LI21:B=on']);
  });

  it('awaits an async put before the next action', async () => {
    const order: string[] = [];
    const ctx = makeCtx({
      pvService: {
        put: async (pv: string) => {
          await new Promise((r) => setTimeout(r, pv.endsWith('A') ? 5 : 0));
          order.push(pv);
        },
      },
    });
    await dispatchActions(
      [
        { type: 'write_pv', pvName: 'X:A', value: 1 },
        { type: 'write_pv', pvName: 'X:B', value: 2 },
      ],
      ctx
    );
    expect(order).toEqual(['X:A', 'X:B']);
  });

  it('open_display target replace navigates', async () => {
    const ctx = makeCtx();
    await dispatchActions([{ type: 'open_display', file: 'main.bob', target: 'replace' }], ctx);
    expect(ctx.resolveManifest).toHaveBeenCalledWith('main.bob');
    expect(ctx.calls).toEqual(['navigate /screens/main']);
  });

  it('open_display target tab opens a window', async () => {
    const ctx = makeCtx();
    await dispatchActions([{ type: 'open_display', file: 'main.bob', target: 'tab' }], ctx);
    expect(ctx.calls).toEqual(['openWindow /screens/main']);
  });

  it('open_display target window opens a window', async () => {
    const ctx = makeCtx();
    await dispatchActions([{ type: 'open_display', file: 'main.bob', target: 'window' }], ctx);
    expect(ctx.calls).toEqual(['openWindow /screens/main']);
  });

  it('open_display with an unknown target falls back to replace', async () => {
    const ctx = makeCtx();
    const action = { type: 'open_display', file: 'main.bob', target: 'popup' } as unknown as Action;
    await dispatchActions([action], ctx);
    expect(ctx.calls).toEqual(['navigate /screens/main']);
  });

  it('open_display with a missing target falls back to replace', async () => {
    const ctx = makeCtx();
    const action = { type: 'open_display', file: 'main.bob' } as unknown as Action;
    await dispatchActions([action], ctx);
    expect(ctx.calls).toEqual(['navigate /screens/main']);
  });

  it('open_display manifest miss shows an error and does not navigate', async () => {
    const ctx = makeCtx({ resolveManifest: vi.fn(() => undefined) });
    await dispatchActions([{ type: 'open_display', file: 'gone.bob', target: 'replace' }], ctx);
    expect(ctx.calls).toEqual(['error No screen for gone.bob']);
    expect(ctx.navigate).not.toHaveBeenCalled();
  });

  it('supports an async resolveManifest', async () => {
    const ctx = makeCtx({ resolveManifest: vi.fn(async () => '/screens/x') });
    await dispatchActions([{ type: 'open_display', file: 'x.bob', target: 'tab' }], ctx);
    expect(ctx.calls).toEqual(['openWindow /screens/x']);
  });

  it('passes resolved open_display macros as query params', async () => {
    const ctx = makeCtx();
    await dispatchActions(
      [
        {
          type: 'open_display',
          file: '${DEV}.bob',
          target: 'replace',
          macros: { MOTOR: '${P}:M1', LABEL: 'a b&c' },
        },
      ],
      ctx
    );
    expect(ctx.resolveManifest).toHaveBeenCalledWith('M1.bob');
    expect(ctx.calls).toEqual(['navigate /screens/M1?MOTOR=LI21%3AM1&LABEL=a+b%26c']);
  });

  it('appends macro params to a URL that already has a query', async () => {
    const ctx = makeCtx({ resolveManifest: () => '/view?id=7' });
    await dispatchActions(
      [{ type: 'open_display', file: 'a.bob', target: 'replace', macros: { A: '1' } }],
      ctx
    );
    expect(ctx.calls).toEqual(['navigate /view?id=7&A=1']);
  });

  it('close_display closes', async () => {
    const ctx = makeCtx();
    await dispatchActions([{ type: 'close_display' }], ctx);
    expect(ctx.calls).toEqual(['close']);
  });

  it('open_webpage opens a window with the URL', async () => {
    const ctx = makeCtx();
    await dispatchActions([{ type: 'open_webpage', url: 'https://example.org/${P}' }], ctx);
    expect(ctx.calls).toEqual(['openWindow https://example.org/LI21']);
  });

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    ' javascript:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:x',
    'file:///etc/passwd',
    '//evil.example/x',
    '/\\evil.example/x',
    '\\\\evil.example/x',
  ])('open_webpage refuses %j with an error and opens nothing', async (url) => {
    const ctx = makeCtx();
    await dispatchActions([{ type: 'open_webpage', url }], ctx);
    expect(ctx.openWindow).not.toHaveBeenCalled();
    expect(ctx.calls).toHaveLength(1);
    expect(ctx.calls[0]).toMatch(/^error Refused to open .*only http, https and relative URLs/);
  });

  it('open_webpage refuses a macro that expands to a javascript: URL', async () => {
    const ctx = makeCtx({ macros: { U: 'javascript:alert(document.cookie)' } });
    await dispatchActions([{ type: 'open_webpage', url: '${U}' }], ctx);
    expect(ctx.openWindow).not.toHaveBeenCalled();
    expect(ctx.showError).toHaveBeenCalledTimes(1);
  });

  it('open_display refuses a non-http(s) screen URL and does not navigate', async () => {
    const ctx = makeCtx({ resolveManifest: vi.fn(() => 'javascript:alert(1)') });
    await dispatchActions([{ type: 'open_display', file: 'main.bob', target: 'tab' }], ctx);
    await dispatchActions([{ type: 'open_display', file: 'main.bob', target: 'replace' }], ctx);
    expect(ctx.openWindow).not.toHaveBeenCalled();
    expect(ctx.navigate).not.toHaveBeenCalled();
    expect(ctx.showError).toHaveBeenCalledTimes(2);
  });

  it('isOpenableUrl accepts http(s) and relative URLs', () => {
    for (const url of [
      'https://example.org/a',
      'HTTP://example.org',
      '/screens/main',
      'screens/main?P=1',
      '../up',
      '?q=1',
      '#frag',
      '',
    ]) {
      expect(isOpenableUrl(url), url).toBe(true);
    }
  });

  it('open_file only warns, once', async () => {
    const ctx = makeCtx();
    const actions: Action[] = [
      { type: 'open_file', file: 'a.txt' },
      { type: 'open_file', file: 'b.txt' },
    ];
    await dispatchActions(actions, ctx);
    await dispatchActions(actions, ctx);
    expect(ctx.calls).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('execute shows "not available here" and sends nothing', async () => {
    const ctx = makeCtx();
    await dispatchActions(
      [
        { type: 'execute', command: 'rm -rf /' },
        { type: 'execute', command: 'ls' },
      ],
      ctx
    );
    expect(ctx.calls).toEqual([`error ${EXECUTE_NOT_AVAILABLE}`, `error ${EXECUTE_NOT_AVAILABLE}`]);
  });

  it('runs mixed actions in declaration order', async () => {
    const ctx = makeCtx();
    await dispatchActions(
      [
        { type: 'write_pv', pvName: 'X', value: 0 },
        { type: 'open_display', file: 'a.bob', target: 'tab' },
        { type: 'close_display' },
      ],
      ctx
    );
    expect(ctx.calls).toEqual(['put X=0', 'openWindow /screens/a', 'close']);
  });

  it('does nothing for an empty list', async () => {
    const ctx = makeCtx();
    await dispatchActions([], ctx);
    expect(ctx.calls).toEqual([]);
  });
});

function outcome(kind: WriteOutcomeKind, coalesced = false): WriteOutcome {
  return { outcome: kind, code: null, status: null, detail: kind, coalesced };
}

/**
 * A gate recording each run into `calls` and answering it with `answer`:
 * 'declined', or the first writes.length of `answer` (the outcomes the
 * gate resolved: a shorter list is a run that stopped).
 */
function fakeGate(calls: string[], answer: 'declined' | WriteOutcome[]) {
  const runs: WriteRequest[][] = [];
  /** The options each run was given, `undefined` for a run given none. */
  const options: unknown[] = [];
  const gate: WriteGateService = {
    confirmWrites: () => true,
    run: async (writes, ...rest) => {
      runs.push([...writes]);
      options.push(rest.length === 0 ? undefined : rest[0]);
      calls.push(`run ${writes.map((w) => `${w.pv}=${w.value}`).join(',')}`);
      if (answer === 'declined') return 'declined';
      return answer.slice(0, writes.length);
    },
  };
  return { gate, runs, options };
}

describe('dispatchActions with a write gate', () => {
  beforeEach(() => {
    resetActionWarnings();
  });

  it("gathers a click's machine write_pv actions into one gate run, never put", async () => {
    const ctx = makeCtx();
    const { gate, runs } = fakeGate(ctx.calls, [outcome('confirmed'), outcome('confirmed')]);
    await dispatchActions(
      [
        { type: 'write_pv', pvName: '${P}:A', value: 1 },
        { type: 'open_webpage', url: 'https://x/' },
        { type: 'write_pv', pvName: '${P}:B', value: 'on' },
        { type: 'close_display' },
      ],
      { ...ctx, gate }
    );
    expect(runs).toEqual([
      [
        { pv: 'LI21:A', value: 1 },
        { pv: 'LI21:B', value: 'on' },
      ],
    ]);
    expect(ctx.calls).toEqual(['run LI21:A=1,LI21:B=on', 'openWindow https://x/', 'close']);
    expect(ctx.pvService.put).not.toHaveBeenCalled();
  });

  it('skips the rest of the list after a decline', async () => {
    const ctx = makeCtx();
    const { gate } = fakeGate(ctx.calls, 'declined');
    await dispatchActions(
      [
        { type: 'open_webpage', url: 'https://before/' },
        { type: 'write_pv', pvName: 'X', value: 1 },
        { type: 'write_pv', pvName: 'loc://after', value: 1 },
        { type: 'open_display', file: 'a.bob', target: 'replace' },
        { type: 'close_display' },
      ],
      { ...ctx, gate }
    );
    expect(ctx.calls).toEqual(['openWindow https://before/', 'run X=1']);
  });

  it('skips the rest of the list after a run that stopped', async () => {
    for (const answer of [
      [outcome('confirmed'), outcome('refused')],
      [outcome('refused')],
      [outcome('confirmed'), outcome('confirmed', true)],
      [outcome('unknown')],
      [],
    ]) {
      const ctx = makeCtx();
      const { gate } = fakeGate(ctx.calls, answer);
      await dispatchActions(
        [
          { type: 'write_pv', pvName: 'A', value: 1 },
          { type: 'write_pv', pvName: 'B', value: 2 },
          { type: 'close_display' },
        ],
        { ...ctx, gate }
      );
      expect(ctx.calls, JSON.stringify(answer)).toEqual(['run A=1,B=2']);
    }
  });

  it('continues after mismatch and unconfirmed (the run completed)', async () => {
    const ctx = makeCtx();
    const { gate } = fakeGate(ctx.calls, [outcome('mismatch'), outcome('unconfirmed')]);
    await dispatchActions(
      [
        { type: 'write_pv', pvName: 'A', value: 1 },
        { type: 'write_pv', pvName: 'B', value: 2 },
        { type: 'close_display' },
      ],
      { ...ctx, gate }
    );
    expect(ctx.calls).toEqual(['run A=1,B=2', 'close']);
  });

  it('keeps loc:// and formula:// writes on the instance router, at their place', async () => {
    const ctx = makeCtx();
    const { gate, runs } = fakeGate(ctx.calls, [outcome('confirmed')]);
    await dispatchActions(
      [
        { type: 'write_pv', pvName: 'loc://$(DEV)', value: 3 },
        { type: 'write_pv', pvName: 'M', value: 1 },
        { type: 'write_pv', pvName: 'formula://calc', value: 4 },
      ],
      { ...ctx, gate }
    );
    expect(runs).toEqual([[{ pv: 'M', value: 1 }]]);
    expect(ctx.calls).toEqual(['put loc://M1=3', 'run M=1', 'put formula://calc=4']);
  });

  it('sends upper-case LOC:// and FORMULA:// names to the gate (the router routes them to the machine)', async () => {
    const ctx = makeCtx();
    const { gate, runs } = fakeGate(ctx.calls, [outcome('confirmed'), outcome('confirmed')]);
    await dispatchActions(
      [
        { type: 'write_pv', pvName: 'LOC://a', value: 1 },
        { type: 'write_pv', pvName: 'FORMULA://b', value: 2 },
      ],
      { ...ctx, gate }
    );
    expect(runs).toEqual([
      [
        { pv: 'LOC://a', value: 1 },
        { pv: 'FORMULA://b', value: 2 },
      ],
    ]);
    expect(ctx.calls.filter((c) => c.startsWith('put'))).toEqual([]);
  });

  it('runs no gate for a list without machine writes', async () => {
    const ctx = makeCtx();
    const { gate, runs } = fakeGate(ctx.calls, 'declined');
    await dispatchActions(
      [{ type: 'write_pv', pvName: 'loc://a', value: 1 }, { type: 'close_display' }],
      { ...ctx, gate }
    );
    expect(runs).toEqual([]);
    expect(ctx.calls).toEqual(['put loc://a=1', 'close']);
  });

  it('treats a rejecting gate as nothing written and stops', async () => {
    const ctx = makeCtx();
    const gate: WriteGateService = {
      confirmWrites: () => false,
      run: () => Promise.reject(new Error('boom')),
    };
    await dispatchActions(
      [{ type: 'write_pv', pvName: 'A', value: 1 }, { type: 'close_display' }],
      { ...ctx, gate }
    );
    expect(ctx.calls).toEqual([]);
    expect(ctx.pvService.put).not.toHaveBeenCalled();
  });

  it('gives the gate no options for a click that does not ask to confirm', async () => {
    const ctx = makeCtx();
    const { gate, options } = fakeGate(ctx.calls, [outcome('confirmed')]);
    await dispatchActions([{ type: 'write_pv', pvName: 'A', value: 1 }], { ...ctx, gate });
    expect(options).toEqual([undefined]);
  });

  it("asks the gate to confirm the click's one run when the node asks", async () => {
    const ctx = makeCtx();
    const { gate, runs, options } = fakeGate(ctx.calls, [
      outcome('confirmed'),
      outcome('confirmed'),
    ]);
    await dispatchActions(
      [
        { type: 'write_pv', pvName: 'A', value: 1 },
        { type: 'write_pv', pvName: 'B', value: 2 },
      ],
      { ...ctx, gate, confirm: true }
    );
    expect(runs).toEqual([
      [
        { pv: 'A', value: 1 },
        { pv: 'B', value: 2 },
      ],
    ]);
    expect(options).toEqual([{ confirm: true }]);
  });

  it('with a null gate writes straight through, as before', async () => {
    const ctx = makeCtx();
    await dispatchActions([{ type: 'write_pv', pvName: 'A', value: 1 }], { ...ctx, gate: null });
    expect(ctx.calls).toEqual(['put A=1']);
  });
});

describe('apply_staged and clear_staged', () => {
  beforeEach(() => {
    resetActionWarnings();
  });

  function stagedView() {
    const staging = createStagingStore();
    for (const pv of ['A', 'B', 'C']) staging.attach('view', pv);
    staging.attach('other', 'Z');
    staging.set('view', { pv: 'A', value: 1, entered: '1.0' });
    staging.set('view', { pv: 'B', value: 2 });
    staging.set('view', { pv: 'C', value: 'on' });
    staging.set('other', { pv: 'Z', value: 9 });
    return staging;
  }
  const apply = { type: 'apply_staged', scope: 'view' } as const;

  it('writes the scope as one gate run, in staging order, and names the stopping channel', async () => {
    const ctx = makeCtx();
    const staging = stagedView();
    const { gate, runs, options } = fakeGate(ctx.calls, [
      outcome('confirmed'),
      outcome('confirmed'),
      outcome('confirmed'),
    ]);
    await dispatchActions([apply, { type: 'close_display' }], { ...ctx, gate, staging });
    expect(runs).toEqual([
      [
        { pv: 'A', value: 1, entered: '1.0' },
        { pv: 'B', value: 2 },
        { pv: 'C', value: 'on' },
      ],
    ]);
    expect(options).toEqual([
      { nameStopped: true, stopUnlessConfirmed: true, check: expect.any(Function) },
    ]);
    expect(staging.list('view')).toEqual([]);
    expect(staging.list('other')).toEqual([{ pv: 'Z', value: 9 }]);
    expect(ctx.calls).toEqual(['run A=1,B=2,C=on', 'close']);
    expect(ctx.pvService.put).not.toHaveBeenCalled();
  });

  it('asks for the dialog when the node asks', async () => {
    const ctx = makeCtx();
    const { gate, options } = fakeGate(ctx.calls, [outcome('confirmed')]);
    const staging = createStagingStore();
    staging.attach('view', 'A');
    staging.set('view', { pv: 'A', value: 1 });
    await dispatchActions([apply], { ...ctx, gate, staging, confirm: true });
    expect(options).toEqual([
      { nameStopped: true, stopUnlessConfirmed: true, confirm: true, check: expect.any(Function) },
    ]);
  });

  it('substitutes macros in the scope', async () => {
    const ctx = makeCtx();
    const { gate, runs } = fakeGate(ctx.calls, [outcome('confirmed')]);
    const staging = createStagingStore();
    staging.attach('LI21/set', 'A');
    staging.set('LI21/set', { pv: 'A', value: 1 });
    await dispatchActions([{ type: 'apply_staged', scope: '${P}/set' }], {
      ...ctx,
      gate,
      staging,
    });
    expect(runs).toEqual([[{ pv: 'A', value: 1 }]]);
  });

  it('a declined dialog keeps every staged value and skips the rest of the list', async () => {
    const ctx = makeCtx();
    const staging = stagedView();
    const { gate } = fakeGate(ctx.calls, 'declined');
    await dispatchActions([apply, { type: 'close_display' }], { ...ctx, gate, staging });
    expect(staging.list('view')).toHaveLength(3);
    expect(ctx.calls).toEqual(['run A=1,B=2,C=on']);
  });

  it('a run that stopped drops the confirmed values and keeps the failed and the unsent', async () => {
    const ctx = makeCtx();
    const staging = stagedView();
    const { gate } = fakeGate(ctx.calls, [outcome('confirmed'), outcome('refused')]);
    await dispatchActions([apply, { type: 'close_display' }], { ...ctx, gate, staging });
    expect(staging.list('view')).toEqual([
      { pv: 'B', value: 2 },
      { pv: 'C', value: 'on' },
    ]);
    expect(ctx.calls).toEqual(['run A=1,B=2,C=on']);
  });

  it('a run that stopped at a readback mismatch keeps that value and the unsent, and skips the rest', async () => {
    const ctx = makeCtx();
    const staging = stagedView();
    // The gate stops a strict run at the mismatch: two outcomes for three writes.
    const { gate } = fakeGate(ctx.calls, [outcome('confirmed'), outcome('mismatch')]);
    await dispatchActions([apply, { type: 'close_display' }], { ...ctx, gate, staging });
    expect(staging.list('view')).toEqual([
      { pv: 'B', value: 2 },
      { pv: 'C', value: 'on' },
    ]);
    expect(ctx.calls).toEqual(['run A=1,B=2,C=on']);
  });

  it('skips the rest of the list when the last value was sent but not confirmed', async () => {
    const ctx = makeCtx();
    const staging = stagedView();
    const { gate } = fakeGate(ctx.calls, [
      outcome('confirmed'),
      outcome('confirmed'),
      outcome('unconfirmed'),
    ]);
    await dispatchActions([apply, { type: 'close_display' }], { ...ctx, gate, staging });
    expect(staging.list('view')).toEqual([{ pv: 'C', value: 'on' }]);
    expect(ctx.calls).toEqual(['run A=1,B=2,C=on']);
  });

  it('a run that lost its backend mid-way drops the confirmed values and keeps the rest', async () => {
    const ctx = makeCtx();
    const staging = stagedView();
    const { gate } = fakeGate(ctx.calls, [outcome('confirmed'), outcome('unknown')]);
    await dispatchActions([apply], { ...ctx, gate, staging });
    expect(staging.list('view').map((v) => v.pv)).toEqual(['B', 'C']);
  });

  describe('while a run writes the scope', () => {
    function held() {
      const ctx = makeCtx();
      const staging = stagedView();
      let finish: (o: WriteOutcome[]) => void = () => {};
      const runs: WriteRequest[][] = [];
      const gate: WriteGateService = {
        confirmWrites: () => false,
        run: (writes) =>
          new Promise((resolve) => {
            runs.push([...writes]);
            finish = resolve;
          }),
      };
      const first = dispatchActions([apply], { ...ctx, gate, staging });
      return { ctx, staging, gate, runs, first, finish: (o: WriteOutcome[]) => finish(o) };
    }
    const allConfirmed = [outcome('confirmed'), outcome('confirmed'), outcome('confirmed')];

    it('a second apply does nothing and skips the rest of its list', async () => {
      const h = held();
      await Promise.resolve();
      expect(h.staging.busy('view')).toBe(true);
      await dispatchActions([apply, { type: 'close_display' }], {
        ...h.ctx,
        gate: h.gate,
        staging: h.staging,
      });
      expect(h.runs).toHaveLength(1);
      expect(h.ctx.calls).toEqual([]);
      h.finish(allConfirmed);
      await h.first;
      expect(h.staging.busy('view')).toBe(false);
      expect(h.staging.list('view')).toEqual([]);
    });

    it('a clear does nothing', async () => {
      const h = held();
      await Promise.resolve();
      await dispatchActions([{ type: 'clear_staged', scope: 'view' }, { type: 'close_display' }], {
        ...h.ctx,
        gate: h.gate,
        staging: h.staging,
      });
      expect(h.staging.count('view')).toBe(3);
      expect(h.ctx.calls).toEqual([]);
      h.finish(allConfirmed);
      await h.first;
    });

    it('a value staged meanwhile is not part of the run and stays staged', async () => {
      const h = held();
      await Promise.resolve();
      h.staging.attach('view', 'D');
      h.staging.set('view', { pv: 'D', value: 4 });
      h.staging.set('view', { pv: 'A', value: 11 });
      h.finish(allConfirmed);
      await h.first;
      expect(h.runs[0].map((x) => x.pv)).toEqual(['A', 'B', 'C']);
      expect(h.staging.list('view')).toEqual([
        { pv: 'A', value: 11 },
        { pv: 'D', value: 4 },
      ]);
    });

    it('the scope is free again after a rejecting gate', async () => {
      const ctx = makeCtx();
      const staging = stagedView();
      const gate: WriteGateService = {
        confirmWrites: () => false,
        run: () => Promise.reject(new Error('boom')),
      };
      await dispatchActions([apply], { ...ctx, gate, staging });
      expect(staging.busy('view')).toBe(false);
    });
  });

  it('writes only the values of its own instance and those embedded below it', async () => {
    const ctx = makeCtx();
    const top = createStagingStore();
    const card = createStagingStore(top);
    const other = createStagingStore(top);
    card.link();
    other.link();
    top.attach('view', 'T');
    card.attach('view', 'C');
    other.attach('view', 'O');
    top.set('view', { pv: 'T', value: 1 });
    card.set('view', { pv: 'C', value: 2 });
    other.set('view', { pv: 'O', value: 3 });
    const { gate, runs } = fakeGate(ctx.calls, [
      outcome('confirmed'),
      outcome('confirmed'),
      outcome('confirmed'),
    ]);
    await dispatchActions([apply], { ...ctx, gate, staging: card });
    expect(runs).toEqual([[{ pv: 'C', value: 2 }]]);
    expect(top.list('view').map((v) => v.pv)).toEqual(['T', 'O']);
    await dispatchActions([apply], { ...ctx, gate, staging: top });
    expect(runs[1].map((x) => x.pv)).toEqual(['T', 'O']);
    expect(top.count('view')).toBe(0);
  });

  it('keeps a value staged again while its write was on the way', async () => {
    const ctx = makeCtx();
    const staging = createStagingStore();
    staging.attach('view', 'A');
    staging.set('view', { pv: 'A', value: 1 });
    const gate: WriteGateService = {
      confirmWrites: () => false,
      run: async (writes) => {
        staging.set('view', { pv: 'A', value: 5 });
        return writes.map(() => outcome('confirmed'));
      },
    };
    await dispatchActions([apply], { ...ctx, gate, staging });
    expect(staging.list('view')).toEqual([{ pv: 'A', value: 5 }]);
  });

  it('treats a rejecting gate as nothing written: every value stays staged', async () => {
    const ctx = makeCtx();
    const staging = stagedView();
    const gate: WriteGateService = {
      confirmWrites: () => false,
      run: () => Promise.reject(new Error('boom')),
    };
    await dispatchActions([apply, { type: 'close_display' }], { ...ctx, gate, staging });
    expect(staging.list('view')).toHaveLength(3);
    expect(ctx.calls).toEqual([]);
  });

  it('with nothing staged, or no staging store, runs nothing and goes on', async () => {
    const ctx = makeCtx();
    const { gate, runs } = fakeGate(ctx.calls, []);
    await dispatchActions([apply, { type: 'close_display' }], {
      ...ctx,
      gate,
      staging: createStagingStore(),
    });
    await dispatchActions([apply, { type: 'close_display' }], { ...ctx, gate });
    expect(runs).toEqual([]);
    expect(ctx.calls).toEqual(['close', 'close']);
  });

  describe('order in a list', () => {
    const list = [
      { type: 'write_pv', pvName: 'W1', value: 7 },
      apply,
      { type: 'write_pv', pvName: 'W2', value: 8 },
      { type: 'write_pv', pvName: 'W3', value: 9 },
      { type: 'close_display' },
    ] as const;
    const three = [outcome('confirmed'), outcome('confirmed'), outcome('confirmed')];

    it('runs in the order written: the writes before, the staged run, the writes after', async () => {
      const ctx = makeCtx();
      const { gate, runs } = fakeGate(ctx.calls, three);
      await dispatchActions(list, { ...ctx, gate, staging: stagedView() });
      expect(runs.map((r) => r.map((x) => x.pv))).toEqual([['W1'], ['A', 'B', 'C'], ['W2', 'W3']]);
      expect(ctx.calls.at(-1)).toBe('close');
    });

    it('a stopped staged run holds back the writes after it', async () => {
      const ctx = makeCtx();
      const { gate, runs } = fakeGate(ctx.calls, [outcome('confirmed')]);
      await dispatchActions(list, { ...ctx, gate, staging: stagedView() });
      expect(runs.map((r) => r.map((x) => x.pv))).toEqual([['W1'], ['A', 'B', 'C']]);
      expect(ctx.calls).not.toContain('close');
    });

    it('a list with no apply_staged is still one run for all its writes', async () => {
      const ctx = makeCtx();
      const { gate, runs } = fakeGate(ctx.calls, three);
      await dispatchActions(
        [
          { type: 'write_pv', pvName: 'W1', value: 7 },
          { type: 'clear_staged', scope: 'none' },
          { type: 'close_display' },
          { type: 'write_pv', pvName: 'W2', value: 8 },
        ],
        { ...ctx, gate, staging: stagedView() }
      );
      expect(runs.map((r) => r.map((x) => x.pv))).toEqual([['W1', 'W2']]);
    });
  });

  describe('one channel staged in two instances', () => {
    function two(a: number, b: number) {
      const top = createStagingStore();
      const left = createStagingStore(top);
      const right = createStagingStore(top);
      left.link();
      right.link();
      for (const s of [top, left, right]) s.attach('view', 'X');
      top.attach('view', 'Y');
      top.set('view', { pv: 'Y', value: 0 });
      left.set('view', { pv: 'X', value: a });
      right.set('view', { pv: 'X', value: b });
      return top;
    }

    it('different values: nothing is sent, the channel is named, all stay staged', async () => {
      const ctx = makeCtx();
      const top = two(1, 2);
      const { gate, runs } = fakeGate(ctx.calls, []);
      await dispatchActions([apply, { type: 'close_display' }], { ...ctx, gate, staging: top });
      expect(runs).toEqual([]);
      expect(ctx.calls).toEqual([
        'error X: staged with different values (1 and 2); nothing written',
      ]);
      // Both conflicting entries are marked, the other value is not.
      expect(top.list('view').map((v) => [v.pv, top.marked(v)])).toEqual([
        ['Y', false],
        ['X', true],
        ['X', true],
      ]);
      expect(top.count('view')).toBe(3);
      expect(top.busy('view')).toBe(false);
    });

    it('says so where write results are shown when the gate can, not through the host', async () => {
      const ctx = makeCtx();
      const top = two(1, 2);
      const said: string[] = [];
      const { gate } = fakeGate(ctx.calls, []);
      gate.refused = (text) => void said.push(text);
      await dispatchActions([apply], { ...ctx, gate, staging: top });
      expect(said).toEqual(['X: staged with different values (1 and 2); nothing written']);
      expect(ctx.calls).toEqual([]);
    });

    it('a later apply after the values agree clears the marks', async () => {
      const ctx = makeCtx();
      const top = two(1, 2);
      const { gate } = fakeGate(ctx.calls, 'declined');
      await dispatchActions([apply], { ...ctx, gate, staging: top });
      const kept = top.list('view').filter((v) => v.pv === 'X');
      top.clear('view', 'X', kept[1]);
      await dispatchActions([apply], { ...ctx, gate, staging: top });
      expect(top.list('view').some((v) => top.marked(v))).toBe(false);
    });

    it('the same value: the channel is written once, both leave staging', async () => {
      const ctx = makeCtx();
      const top = two(5, 5);
      const { gate, runs } = fakeGate(ctx.calls, [outcome('confirmed'), outcome('confirmed')]);
      await dispatchActions([apply], { ...ctx, gate, staging: top });
      expect(runs).toEqual([
        [
          { pv: 'Y', value: 0 },
          { pv: 'X', value: 5 },
        ],
      ]);
      expect(top.count('view')).toBe(0);
    });
  });

  describe('a value that leaves the screen during the run', () => {
    it('hands the gate a check that refuses a value no longer staged or since replaced', async () => {
      const ctx = makeCtx();
      const staging = createStagingStore();
      const detach = ['A', 'B', 'C'].map((pv) => staging.attach('view', pv));
      for (const pv of ['A', 'B', 'C']) staging.set('view', { pv, value: 1 });
      const verdicts: Array<string | null> = [];
      const gate: WriteGateService = {
        confirmWrites: () => false,
        run: async (writes, options) => {
          detach[1]!();
          staging.set('view', { pv: 'C', value: 9 });
          writes.forEach((w, i) => verdicts.push(options?.check?.(w, i) ?? null));
          return [outcome('confirmed'), outcome('refused')];
        },
      };
      await dispatchActions([apply], { ...ctx, gate, staging });
      expect(verdicts).toEqual([null, 'no longer on screen', 'no longer on screen']);
      expect(staging.list('view')).toEqual([{ pv: 'C', value: 9 }]);
    });

    it('with no gate stops before a value that is gone', async () => {
      const ctx = makeCtx();
      const staging = createStagingStore();
      const detach = ['A', 'B'].map((pv) => staging.attach('view', pv));
      for (const pv of ['A', 'B']) staging.set('view', { pv, value: 1 });
      ctx.pvService.put = vi.fn((pv: string) => {
        ctx.calls.push(`put ${pv}`);
        detach[1]!();
      });
      await dispatchActions([apply, { type: 'close_display' }], { ...ctx, gate: null, staging });
      expect(ctx.calls).toEqual(['put A']);
    });
  });

  it('with no gate writes each value straight through and drops it', async () => {
    const ctx = makeCtx();
    const staging = stagedView();
    await dispatchActions([apply], { ...ctx, gate: null, staging });
    expect(ctx.calls).toEqual(['put A=1', 'put B=2', 'put C=on']);
    expect(staging.list('view')).toEqual([]);
  });

  it('clear_staged drops the scope unwritten', async () => {
    const ctx = makeCtx();
    const staging = stagedView();
    const { gate, runs } = fakeGate(ctx.calls, []);
    await dispatchActions([{ type: 'clear_staged', scope: 'view' }, { type: 'close_display' }], {
      ...ctx,
      gate,
      staging,
    });
    expect(staging.list('view')).toEqual([]);
    expect(staging.list('other')).toHaveLength(1);
    expect(runs).toEqual([]);
    expect(ctx.calls).toEqual(['close']);
  });
});

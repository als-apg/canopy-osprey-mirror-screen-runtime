// IR → widget prop mapping details that carry semantics beyond renaming.

import { describe, expect, it } from 'vitest';
import { mapIRWidget } from './irMap.js';

describe('pv-label precision source', () => {
  it('defaults precisionFromPV to false for fox:// formula channels', () => {
    const mapped = mapIRWidget('pv-label', { pv: 'fox://f-001', precision: 3 });
    expect(mapped?.props).toMatchObject({
      pvName: 'fox://f-001',
      precision: 3,
      precisionFromPV: false,
    });
  });

  it('leaves plain PV channels and explicit IR values alone', () => {
    expect(mapIRWidget('pv-label', { pv: 'DEV:X', precision: 3 })?.props).not.toHaveProperty(
      'precisionFromPV'
    );
    expect(
      mapIRWidget('pv-label', { pv: 'fox://f-001', precision: 3, precisionFromPV: true })?.props
        .precisionFromPV
    ).toBe(true);
  });
});

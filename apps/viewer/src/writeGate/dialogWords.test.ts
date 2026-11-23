// The words of the confirmation dialog: the built title and button word, and
// the texts of the rows.
import { describe, expect, it } from 'vitest';
import type { PVData } from '@slaclab/canopy-client';
import {
  NOT_CONNECTED,
  NO_CHANGE,
  NO_VALUE,
  changeCount,
  dialogTitle,
  dialogVerb,
  differenceText,
  enteredNote,
  isPulse,
  limitsText,
  nowText,
  writtenText,
} from './dialogWords.js';

const live = (data: Partial<PVData>): PVData => ({ connected: true, ...data }) as PVData;
const noUnit = () => '';

describe('dialogTitle and dialogVerb', () => {
  const one = [{ pv: 'DEV:PS1:Setpoint', value: 0.14 }];
  const two = [...one, { pv: 'DEV:PS1:RampRate', value: 0.5 }];
  const pulse = [
    { pv: 'DEV:CMD', value: 1 },
    { pv: 'DEV:CMD', value: 0, release: true },
  ];

  it("the screen's title and verb win over anything built", () => {
    const say = { title: 'Start the ramp?', verb: 'Start', label: 'Go', action: 'press' } as const;
    expect(dialogTitle(two, say, noUnit)).toBe('Start the ramp?');
    expect(dialogVerb(two, say)).toBe('Start');
  });

  it('a labelled press is its label as a question', () => {
    expect(dialogTitle(pulse, { label: 'Reset', action: 'press' }, noUnit)).toBe('Reset?');
    expect(dialogVerb(pulse, { label: 'Reset', action: 'press' })).toBe('Reset');
    // A label that already asks, or trails off, is not given a second mark.
    expect(dialogTitle(one, { label: 'Reset?' }, noUnit)).toBe('Reset?');
    expect(dialogTitle(one, { label: 'Reset…' }, noUnit)).toBe('Reset?');
    expect(dialogTitle(one, { label: 'Reset...' }, noUnit)).toBe('Reset?');
  });

  it('a set point names its label, else its channel, with the value and unit', () => {
    const unit = () => 'A';
    expect(dialogTitle(one, { label: 'PS1 current', action: 'set' }, unit)).toBe(
      'Set PS1 current to 0.14 A?'
    );
    expect(dialogTitle(one, { action: 'set' }, unit)).toBe('Set DEV:PS1:Setpoint to 0.14 A?');
    expect(dialogVerb(one, { label: 'PS1 current', action: 'set' })).toBe('Set');
  });

  it('an item chosen by its index is named by its text, without a unit', () => {
    const chosen = [{ pv: 'DEV:MODE', value: 3, chosen: 'On (3)' }];
    expect(dialogTitle(chosen, { action: 'set' }, () => 'A')).toBe('Set DEV:MODE to On (3)?');
  });

  it('several changes are counted; a pulse counts once', () => {
    expect(isPulse(pulse)).toBe(true);
    expect(isPulse(two)).toBe(false);
    expect(changeCount(pulse)).toBe(1);
    expect(dialogTitle(two, { label: 'Apply', action: 'apply' }, noUnit)).toBe('Apply 2 changes?');
    expect(dialogVerb(two, { label: 'Apply', action: 'apply' })).toBe('Apply 2');
    expect(dialogTitle(pulse, null, noUnit)).toBe('Write 1 to DEV:CMD?');
    expect(dialogVerb(pulse, null)).toBe('Write');
  });

  it('is never the bare question when a write is known', () => {
    for (const say of [null, {}, { action: 'press' } as const]) {
      expect(dialogTitle(one, say, noUnit)).toBe('Write 0.14 to DEV:PS1:Setpoint?');
      expect(dialogVerb(one, say)).toBe('Write');
    }
  });
});

describe('the rows', () => {
  it('"now" is the shown value, with the unit when the shown value lacks it', () => {
    expect(nowText(live({ value: 1.5, displayValue: '1.50 mm', units: 'mm' }))).toEqual({
      text: '1.50 mm',
      known: true,
    });
    expect(nowText(live({ value: 1.5, displayValue: '1.5', units: 'mm' })).text).toBe('1.5 mm');
    expect(nowText(live({ value: 'Off', displayValue: 'Off', units: 'mm' })).text).toBe('Off');
  });

  it('"now" says plainly when there is no value', () => {
    expect(nowText(undefined)).toEqual({ text: NOT_CONNECTED, known: false });
    expect(nowText(live({ connected: false, value: 0, displayValue: '0' }))).toEqual({
      text: NOT_CONNECTED,
      known: false,
    });
    expect(nowText(live({ value: '', displayValue: '' }))).toEqual({
      text: NO_VALUE,
      known: false,
    });
  });

  it('the written value carries the unit only for a number', () => {
    expect(writtenText({ pv: 'A', value: 2 }, 'mm')).toBe('2 mm');
    expect(writtenText({ pv: 'A', value: 2 }, '')).toBe('2');
    expect(writtenText({ pv: 'A', value: 'On' }, 'mm')).toBe('"On"');
    expect(writtenText({ pv: 'A', value: 3, chosen: 'On (3)' }, 'mm')).toBe('On (3)');
  });

  it('the typed text is noted only when it reads differently from the value', () => {
    expect(enteredNote({ pv: 'A', value: 1000, entered: '1e3' })).toBe('(entered "1e3")');
    expect(enteredNote({ pv: 'A', value: 2.5, entered: ' 2.5 ' })).toBeNull();
    expect(enteredNote({ pv: 'A', value: 2.5 })).toBeNull();
  });

  it('the difference is signed and free of floating-point noise', () => {
    const now = live({ value: 0.125, precision: 4 });
    expect(differenceText(now, { pv: 'A', value: 0.14 })).toBe('+0.0150');
    expect(differenceText(now, { pv: 'A', value: 0.1 })).toBe('-0.0250');
    expect(differenceText(live({ value: 0.125 }), { pv: 'A', value: 0.14 })).toBe('+0.015');
    expect(differenceText(live({ value: 3 }), { pv: 'A', value: 10 })).toBe('+7');
    expect(differenceText(live({ value: 2e-7 }), { pv: 'A', value: 1e-7 })).toBe('-0.0000001');
    expect(differenceText(now, { pv: 'A', value: 0.125 })).toBe(NO_CHANGE);
  });

  it('there is no difference where it is not a number minus a number', () => {
    expect(differenceText(undefined, { pv: 'A', value: 1 })).toBeNull();
    expect(differenceText(live({ connected: false, value: 0 }), { pv: 'A', value: 1 })).toBeNull();
    expect(differenceText(live({ value: 'Off' }), { pv: 'A', value: 1 })).toBeNull();
    expect(differenceText(live({ value: 1 }), { pv: 'A', value: 'On' })).toBeNull();
    expect(differenceText(live({ value: 1 }), { pv: 'A', value: 3, chosen: 'On' })).toBeNull();
    expect(
      differenceText(live({ value: 0, enumChoices: ['Off', 'On'] }), { pv: 'A', value: 1 })
    ).toBeNull();
  });

  it('the limits are the range and the unit', () => {
    expect(limitsText({ low: -10, high: 10 }, 'mrad')).toBe('-10 … 10 mrad');
    expect(limitsText({ low: 0, high: 5 }, '')).toBe('0 … 5');
  });
});

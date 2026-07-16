// makeResolveAsset: relative refs resolve against the screen document's
// directory under the screens base; absolute/root-relative pass through.

import { describe, expect, it } from 'vitest';
import { makeResolveAsset } from './api.js';

const SCREEN_PATH = 'screens/examples/vacuum-system.screen.json';

describe('makeResolveAsset', () => {
  it('resolves a relative filename against the screen directory under baseUrl', () => {
    const resolve = makeResolveAsset('https://host/canopy-screens', SCREEN_PATH);
    expect(resolve('beamline.png')).toBe(
      'https://host/canopy-screens/screens/examples/beamline.png'
    );
    expect(resolve('images/beamline.png')).toBe(
      'https://host/canopy-screens/screens/examples/images/beamline.png'
    );
  });

  it('resolves ../ segments within the base', () => {
    const resolve = makeResolveAsset('https://host/canopy-screens', SCREEN_PATH);
    expect(resolve('../shared/logo.png')).toBe(
      'https://host/canopy-screens/screens/shared/logo.png'
    );
  });

  it('resolves against the page origin when baseUrl is empty', () => {
    const resolve = makeResolveAsset('', SCREEN_PATH);
    expect(resolve('beamline.png')).toBe(`${window.location.origin}/screens/examples/beamline.png`);
  });

  it('handles a screen document at the manifest root (no directory)', () => {
    const resolve = makeResolveAsset('https://host/base', 'top.screen.json');
    expect(resolve('beamline.png')).toBe('https://host/base/beamline.png');
  });

  it('passes absolute URLs and root-relative paths through untouched', () => {
    const resolve = makeResolveAsset('https://host/base', SCREEN_PATH);
    expect(resolve('https://elsewhere/img.png')).toBe('https://elsewhere/img.png');
    expect(resolve('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    expect(resolve('blob:https://host/1234')).toBe('blob:https://host/1234');
    expect(resolve('/static/img.png')).toBe('/static/img.png');
  });
});

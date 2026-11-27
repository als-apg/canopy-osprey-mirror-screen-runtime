// pushChannel: a hello's capabilities decide which topics are pushed; events
// reach a topic's listeners only while it is.

import { describe, expect, it, vi } from 'vitest';
import { bareEtag, createPushChannel, helloCapabilities, sameEtag } from './pushChannel.js';

describe('helloCapabilities', () => {
  it('reads the listed strings', () => {
    expect(helloCapabilities({ capabilities: ['manifest-events', 7, 'x'] })).toEqual([
      'manifest-events',
      'x',
    ]);
  });

  it('is empty for a hello without the field, or none at all', () => {
    expect(helloCapabilities({ epoch: 1, activeWindow: 'w' })).toEqual([]);
    expect(helloCapabilities({ capabilities: 'manifest-events' })).toEqual([]);
    expect(helloCapabilities(null)).toEqual([]);
  });
});

describe('sameEtag', () => {
  it('compares weakly, quotes or not', () => {
    expect(bareEtag('W/"abc"')).toBe('abc');
    expect(sameEtag('"abc"', 'abc')).toBe(true);
    expect(sameEtag('W/"abc"', '"abc"')).toBe(true);
    expect(sameEtag('"abc"', '"abd"')).toBe(false);
  });

  it('is false when either is missing', () => {
    expect(sameEtag(null, null)).toBe(false);
    expect(sameEtag('"a"', null)).toBe(false);
  });
});

describe('createPushChannel', () => {
  it('pushes nothing before a hello, and nothing a hello does not announce', () => {
    const channel = createPushChannel();
    const manifest = vi.fn();
    channel.source('manifest').subscribe(manifest);
    expect(channel.source('manifest').active()).toBe(false);
    channel.event('manifest', { etag: '"m1"' });
    expect(manifest).not.toHaveBeenCalled();

    channel.opened([]);
    expect(channel.source('manifest').active()).toBe(false);
    channel.event('manifest', { etag: '"m1"' });
    expect(manifest).not.toHaveBeenCalled();
  });

  it('tells a topic once when a stream that pushes it opens, then each event with its etag', () => {
    const channel = createPushChannel();
    const manifest = vi.fn();
    const collections = vi.fn();
    channel.source('manifest').subscribe(manifest);
    channel.source('collections').subscribe(collections);

    channel.opened(['manifest-events', 'something-else']);
    expect(channel.source('manifest').active()).toBe(true);
    expect(channel.source('collections').active()).toBe(false);
    expect(manifest.mock.calls).toEqual([[null]]);
    expect(collections).not.toHaveBeenCalled();

    channel.event('manifest', { type: 'manifest', etag: '"m2"' });
    channel.event('collections', { type: 'collections' });
    channel.event('unknown', {});
    expect(manifest.mock.calls).toEqual([[null], ['"m2"']]);
    expect(collections).not.toHaveBeenCalled();
  });

  it('gives null for an event without an etag', () => {
    const channel = createPushChannel();
    const collections = vi.fn();
    channel.source('collections').subscribe(collections);
    channel.opened(['collections-events']);
    channel.event('collections', { type: 'collections' });
    channel.event('collections', null);
    expect(collections.mock.calls).toEqual([[null], [null], [null]]);
  });

  it('stops pushing when the stream closes, and starts over on the next hello', () => {
    const channel = createPushChannel();
    const manifest = vi.fn();
    const off = channel.source('manifest').subscribe(manifest);
    channel.opened(['manifest-events']);
    channel.closed();
    expect(channel.source('manifest').active()).toBe(false);
    channel.event('manifest', { etag: '"m2"' });
    expect(manifest).toHaveBeenCalledTimes(1);

    channel.opened(['manifest-events']);
    expect(manifest).toHaveBeenCalledTimes(2);
    off();
    channel.event('manifest', { etag: '"m3"' });
    expect(manifest).toHaveBeenCalledTimes(2);
  });
});

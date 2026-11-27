// screenDocuments: one manifest request for callers that ask together, and a
// screen document fetched early is taken once by the load that follows.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PREFETCH_MAX,
  PREFETCH_TTL_MS,
  fetchManifestShared,
  loadScreenDocument,
  prefetchScreenDocument,
  resetScreenDocuments,
} from './screenDocuments.js';

const BASE = 'http://h/drafts';
const PATH = 'screens/a.screen.json';

let fetchMock: ReturnType<typeof vi.fn>;
let fail: boolean;

beforeEach(() => {
  resetScreenDocuments();
  vi.useFakeTimers({ toFake: ['Date'] });
  fail = false;
  fetchMock = vi.fn(async (url: string) => {
    if (fail) return new Response('no', { status: 500, statusText: 'Down' });
    if (url.endsWith('manifest.json')) return new Response('{"screens":[]}', { status: 200 });
    return new Response(JSON.stringify({ id: url }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('fetchManifestShared', () => {
  it('shares one request among callers that ask while it is in flight', async () => {
    const [a, b] = await Promise.all([fetchManifestShared(BASE), fetchManifestShared(BASE)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it('asks again once the request has landed', async () => {
    await fetchManifestShared(BASE);
    await fetchManifestShared(BASE);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps a fetch past the HTTP cache apart, and forgets a failed one', async () => {
    await Promise.all([fetchManifestShared(BASE), fetchManifestShared(BASE, { fresh: true })]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]![1]).toEqual({ cache: 'no-cache' });

    fail = true;
    await expect(fetchManifestShared(BASE)).rejects.toThrow('500');
    fail = false;
    await expect(fetchManifestShared(BASE)).resolves.toEqual({ screens: [] });
  });
});

describe('prefetchScreenDocument and loadScreenDocument', () => {
  it('loads with a fetch of its own when nothing was started', async () => {
    await loadScreenDocument(BASE, PATH, 'r1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('takes the started fetch, once', async () => {
    prefetchScreenDocument(BASE, PATH, 'r1');
    prefetchScreenDocument(BASE, PATH, 'r1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await loadScreenDocument(BASE, PATH, 'r1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await loadScreenDocument(BASE, PATH, 'r1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not take a fetch started for another rev', async () => {
    prefetchScreenDocument(BASE, PATH, 'r1');
    await loadScreenDocument(BASE, PATH, 'r2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not take a started fetch for a load past the HTTP cache', async () => {
    prefetchScreenDocument(BASE, PATH, 'r1');
    await loadScreenDocument(BASE, PATH, 'r1', { fresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]![1]).toEqual({ cache: 'no-cache' });
  });

  it('does not take a fetch started longer ago than PREFETCH_TTL_MS', async () => {
    prefetchScreenDocument(BASE, PATH, 'r1');
    vi.advanceTimersByTime(PREFETCH_TTL_MS + 1);
    await loadScreenDocument(BASE, PATH, 'r1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fetches for itself when the started fetch failed', async () => {
    fail = true;
    prefetchScreenDocument(BASE, PATH, 'r1');
    const loading = loadScreenDocument(BASE, PATH, 'r1');
    fail = false;
    await expect(loading).resolves.toEqual({ id: `${BASE}/${PATH}` });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps only the last PREFETCH_MAX started fetches', async () => {
    for (let i = 0; i <= PREFETCH_MAX; i += 1) prefetchScreenDocument(BASE, `screens/${i}`, 'r');
    expect(fetchMock).toHaveBeenCalledTimes(PREFETCH_MAX + 1);
    await loadScreenDocument(BASE, `screens/${PREFETCH_MAX}`, 'r');
    expect(fetchMock).toHaveBeenCalledTimes(PREFETCH_MAX + 1);
    await loadScreenDocument(BASE, 'screens/0', 'r');
    expect(fetchMock).toHaveBeenCalledTimes(PREFETCH_MAX + 2);
  });
});

// useWorkspaceManifest: the held manifest changes identity only when the
// server's ETag does; the content is compared only without an ETag.

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Manifest } from '../api.js';
import { useWorkspaceManifest } from './useWorkspaceManifest.js';

const BASE = 'http://h/drafts';

let body: Manifest;
let etag: string | null;
let fetchMock: ReturnType<typeof vi.fn>;

function screens(rev: string): Manifest {
  return {
    screens: [{ id: 'a', kind: 'ir', title: 'A', category: 'drafts', path: 'screens/a', rev }],
  };
}

beforeEach(() => {
  body = screens('r1');
  etag = '"m1"';
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (etag !== null && new Headers(init?.headers).get('If-None-Match') === etag) {
      return new Response(null, { status: 304, headers: { ETag: etag } });
    }
    // The text is built here, so the hook's own JSON.stringify calls stand out.
    return new Response(`{"screens":${stringify(body.screens)}}`, {
      status: 200,
      headers: etag === null ? {} : { ETag: etag },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const stringify = JSON.stringify.bind(JSON);

async function mount() {
  const hook = renderHook(() => useWorkspaceManifest(BASE));
  await act(async () => {});
  return hook;
}

describe('useWorkspaceManifest', () => {
  it('keeps the held manifest when a refetch answers with the same ETag, serialising nothing', async () => {
    const hook = await mount();
    const first = hook.result.current.manifest;
    expect(first).toEqual(screens('r1'));

    const serialised = vi.spyOn(JSON, 'stringify');
    await act(async () => {
      await hook.result.current.refetch();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(hook.result.current.manifest).toBe(first);
    expect(serialised).not.toHaveBeenCalled();
  });

  it('adopts a manifest answered with a new ETag without serialising it', async () => {
    const hook = await mount();
    const first = hook.result.current.manifest;
    body = screens('r2');
    etag = '"m2"';
    const serialised = vi.spyOn(JSON, 'stringify');
    let fresh: Manifest | null = null;
    await act(async () => {
      fresh = await hook.result.current.refetch();
    });
    expect(hook.result.current.manifest).not.toBe(first);
    expect(hook.result.current.manifest).toEqual(screens('r2'));
    expect(fresh).toEqual(screens('r2'));
    expect(serialised).not.toHaveBeenCalled();
  });

  it('compares the content when the server sends no ETag', async () => {
    etag = null;
    const hook = await mount();
    const first = hook.result.current.manifest;
    await act(async () => {
      await hook.result.current.refetch();
    });
    expect(hook.result.current.manifest).toBe(first);

    body = screens('r2');
    await act(async () => {
      await hook.result.current.refetch();
    });
    expect(hook.result.current.manifest).toEqual(screens('r2'));
  });

  it('answers null from a failed refetch and keeps the manifest', async () => {
    const hook = await mount();
    const first = hook.result.current.manifest;
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    let fresh: Manifest | null = first;
    await act(async () => {
      fresh = await hook.result.current.refetch();
    });
    expect(fresh).toBeNull();
    expect(hook.result.current.manifest).toBe(first);
  });
});

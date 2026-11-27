// The workspace's manifest: fetched past the HTTP cache on mount, on window
// focus, when the page comes back on screen and every MANIFEST_POLL_MS while
// it is on screen, conditionally on the last ETag (useConditionalManifestPoll),
// so an unchanged manifest is a bodiless 304 that touches nothing. The tree,
// tab titles and tab-missing derive from it, and every mounted screen's draft
// live reload reads it through SharedManifestContext, so the page runs one
// poll, not one per screen.
//
// Whether an answered manifest is the one already held is decided by its
// ETag, kept beside the parsed value: the same ETag keeps the held object, so
// nothing re-renders and nothing is serialised. Only a server that sends no
// ETag (every poll then answers 200) falls back to comparing the content.
//
// `push`: the server's manifest events, when its stream announces them. While
// they flow the interval stands down and the manifest is fetched when an
// event says it changed (useConditionalManifestPoll).

import { useCallback, useState } from 'react';
import type { Manifest } from '../api.js';
import { pollManifest } from '../api.js';
import type { PushSource } from '../pushChannel.js';
import { useConditionalManifestPoll } from '../useManifestPoll.js';

interface Held {
  base: string;
  /** The ETag the manifest was answered with; null when the server sent none. */
  etag: string | null;
  value: Manifest;
}

/** Whether `value`, answered with `etag`, is the manifest already held. */
function unchanged(prev: Held, base: string, value: Manifest, etag: string | null): boolean {
  if (prev.base !== base) return false;
  if (etag !== null || prev.etag !== null) return etag === prev.etag;
  return JSON.stringify(prev.value) === JSON.stringify(value);
}

/**
 * The latest manifest for `screensBaseUrl` (null before the first one) and a
 * one-shot `refetch` past the HTTP cache (null when it fails). A failed fetch
 * keeps the last manifest; an unchanged one keeps its identity, so nothing
 * re-renders. `push` is the manifest topic of the page's push channel.
 */
export function useWorkspaceManifest(
  screensBaseUrl: string,
  push?: PushSource
): {
  manifest: Manifest | null;
  refetch: () => Promise<Manifest | null>;
} {
  const [manifest, setManifest] = useState<Held | null>(null);
  const adopt = useCallback(
    (value: Manifest, etag: string | null) => {
      setManifest((prev) =>
        prev && unchanged(prev, screensBaseUrl, value, etag)
          ? prev
          : { base: screensBaseUrl, etag, value }
      );
    },
    [screensBaseUrl]
  );
  // One fetch past the HTTP cache, now (the apply loop's refetch before an
  // unknown target stands); null when it fails.
  const refetch = useCallback(async (): Promise<Manifest | null> => {
    try {
      const result = await pollManifest(screensBaseUrl, null);
      if (!result.changed) return null;
      adopt(result.manifest, result.etag);
      return result.manifest;
    } catch {
      return null;
    }
  }, [screensBaseUrl, adopt]);

  useConditionalManifestPoll(screensBaseUrl, adopt, { eager: true, push });

  return {
    manifest: manifest && manifest.base === screensBaseUrl ? manifest.value : null,
    refetch,
  };
}

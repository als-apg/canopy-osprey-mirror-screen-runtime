// Mounts the window's workspace sync (workspaceSync.ts) in a workspace page.
// Only a chrome workspace whose config advertises a workspace participates:
// `enabled` false (chrome off) or no `workspace` advertisement mounts nothing
// and makes no workspace request. Screen pages (/s/*) never render a
// workspace, so they never get here.
//
// The sync reads the window's state through `getState` at send time, so the
// latest tabs, grid, zoom and titles are reported without re-creating it;
// `changed()` on the returned ref feeds the throttled reporter.

import { useEffect, useLayoutEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import type { WorkspaceConfig } from '../config.js';
import type { PushChannel } from '../pushChannel.js';
import type { WorkspaceState } from './workspaceState.js';
import { createWorkspaceSync } from './workspaceSync.js';
import type { BatchEvent, WorkspaceSync } from './workspaceSync.js';

export interface UseWorkspaceSyncOptions {
  /** False for a chrome-off workspace. */
  enabled: boolean;
  /** config.workspace; undefined -> no sync. */
  workspace: WorkspaceConfig | undefined;
  /** The window's current state (buildState over the live inputs). */
  getState: () => WorkspaceState;
  /** Each batch delivered to this window. */
  onBatch?: (batch: BatchEvent) => void;
  /** Told what the hub's stream pushes (pushChannel.ts), so the page's polls can stand down. */
  push?: PushChannel;
}

/** The running sync, or null when this page does not participate. */
export function useWorkspaceSync({
  enabled,
  workspace,
  getState,
  onBatch,
  push,
}: UseWorkspaceSyncOptions): MutableRefObject<WorkspaceSync | null> {
  const sync = useRef<WorkspaceSync | null>(null);
  const stateSource = useRef(getState);
  const batchSink = useRef(onBatch);
  useLayoutEffect(() => {
    stateSource.current = getState;
    batchSink.current = onBatch;
  });
  const path = workspace?.path;
  const protocol = workspace?.protocol;

  useEffect(() => {
    if (!enabled || path === undefined || protocol === undefined) return;
    if (typeof EventSource === 'undefined') return;
    const running = createWorkspaceSync({
      workspace: { path, protocol },
      getState: () => stateSource.current(),
      onBatch: (batch) => batchSink.current?.(batch),
      onHello: (capabilities) => push?.opened(capabilities),
      onPush: (type, data) => push?.event(type, data),
      onStreamClosed: () => push?.closed(),
    });
    sync.current = running;
    running.start();
    return () => {
      running.stop();
      if (sync.current === running) sync.current = null;
    };
  }, [enabled, path, protocol, push]);

  return sync;
}

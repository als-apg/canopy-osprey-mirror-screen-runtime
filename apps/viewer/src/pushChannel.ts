// What the server pushes over the workspace's event stream, for the loops that
// would otherwise poll for it. A server says what it pushes in its `hello`
// (`capabilities: ["manifest-events", ...]`); a server that says nothing
// pushes nothing, and every loop polls as before. The stream exists only
// while this window holds the workspace's active slot, so pushing ends when
// the stream closes and the interval poll takes over again.
//
//   topic        capability            event
//   manifest     manifest-events       {type: "manifest", etag}
//   collections  collections-events    {type: "collections"}

export type PushTopic = 'manifest' | 'collections';

/** The topics a server may push, and the capability that announces each. */
export const PUSH_CAPABILITY: Readonly<Record<PushTopic, string>> = {
  manifest: 'manifest-events',
  collections: 'collections-events',
};

/** While a topic is pushed, its loop polls only this often, as a safety net. */
export const PUSH_SAFETY_POLL_MS = 60_000;

/** One topic of the channel, as a poll loop reads it. */
export interface PushSource {
  /** True while an open stream pushes this topic. */
  active(): boolean;
  /**
   * `listener` runs when the topic changed (with the event's etag, null when
   * it carries none) and once whenever a stream that pushes the topic opens
   * (null: what happened while there was none is unknown). Returns the
   * unsubscribe.
   */
  subscribe(listener: (etag: string | null) => void): () => void;
}

export interface PushChannel {
  /** A stream opened and said hello with these capabilities. */
  opened(capabilities: readonly string[]): void;
  /** The stream is gone. */
  closed(): void;
  /** The stream delivered an event of `type` (unknown types are ignored). */
  event(type: string, data: unknown): void;
  source(topic: PushTopic): PushSource;
}

/** An ETag as comparable text: no weak prefix, no quotes. */
export function bareEtag(etag: string): string {
  return etag.replace(/^W\//, '').replace(/^"(.*)"$/, '$1');
}

/** Whether two ETags name the same version (weak comparison); false when either is missing. */
export function sameEtag(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && bareEtag(a) === bareEtag(b);
}

/** The string capabilities of a hello event's data. */
export function helloCapabilities(hello: unknown): string[] {
  const listed = (hello as { capabilities?: unknown } | null)?.capabilities;
  return Array.isArray(listed) ? listed.filter((c): c is string => typeof c === 'string') : [];
}

export function createPushChannel(): PushChannel {
  let pushed = new Set<PushTopic>();
  const listeners: Record<PushTopic, Set<(etag: string | null) => void>> = {
    manifest: new Set(),
    collections: new Set(),
  };
  const notify = (topic: PushTopic, etag: string | null) => {
    for (const listener of [...listeners[topic]]) listener(etag);
  };
  const topics = Object.keys(PUSH_CAPABILITY) as PushTopic[];
  return {
    opened(capabilities) {
      pushed = new Set(topics.filter((topic) => capabilities.includes(PUSH_CAPABILITY[topic])));
      for (const topic of pushed) notify(topic, null);
    },
    closed() {
      pushed = new Set();
    },
    event(type, data) {
      const topic = topics.find((t) => t === type);
      if (topic === undefined || !pushed.has(topic)) return;
      const etag = (data as { etag?: unknown } | null)?.etag;
      notify(topic, typeof etag === 'string' ? etag : null);
    },
    source: (topic) => ({
      active: () => pushed.has(topic),
      subscribe(listener) {
        listeners[topic].add(listener);
        return () => void listeners[topic].delete(listener);
      },
    }),
  };
}

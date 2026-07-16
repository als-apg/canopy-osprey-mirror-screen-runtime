// `fox://` reference helpers.
//
// These mirror the (unexported) helpers in @slaclab/canopy-screen-ir's
// formula.ts — the IR package's public surface is frozen, so the runtime
// carries its own copies of these three-liners rather than altering it.

/** Prefix marking a value as a formula reference (`fox://<name>`) rather than a PV. */
export const FOX_PREFIX = 'fox://';

/** Whether `value` is a `fox://` formula reference. */
export function isFoxRef(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(FOX_PREFIX);
}

/** The bare formula name behind a reference, with the `fox://` prefix stripped if present. */
export function foxName(ref: string): string {
  return ref.startsWith(FOX_PREFIX) ? ref.slice(FOX_PREFIX.length) : ref;
}

// Whether this page is really on screen. `document.visibilityState` alone
// answers for the browser tab: inside a frame that a host page keeps loaded
// but hides (display: none), the document still reads "visible". Such a frame
// has a 0 x 0 viewport, so the page counts as shown only when the document is
// visible AND the window has a size. The size is read when asked: a hidden
// frame gets no rendering updates, so no observer or event can be trusted to
// report that it went away, or that it came back.

/** The subset of a window the check reads and listens to. */
export interface PanelWindow {
  readonly innerWidth: number;
  readonly innerHeight: number;
  addEventListener(type: 'resize', listener: () => void): void;
  removeEventListener(type: 'resize', listener: () => void): void;
}

/** The subset of a document the check reads and listens to. */
export interface PanelDocument {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

/** True when the document is visible and its window has a non-zero size. */
export function isPanelShown(win: PanelWindow = window, doc: PanelDocument = document): boolean {
  return doc.visibilityState === 'visible' && win.innerWidth > 0 && win.innerHeight > 0;
}

/** A watch on the page being on screen. */
export interface PanelWatch {
  /**
   * Whether the page is on screen now. A reading that finds it back since the
   * last one calls `onShown` first.
   */
  check(): boolean;
  stop(): void;
}

/**
 * Calls `onShown` each time the page comes back on screen: the document
 * becomes visible, or the window gets a size again (the host shows the frame).
 * The browser's events are one trigger; a frame that was hidden may come back
 * at its old size without any, so a loop also calls `check()` on its own tick
 * and the return is noticed there at the latest.
 */
export function watchPanel(
  onShown: () => void,
  win: PanelWindow = window,
  doc: PanelDocument = document
): PanelWatch {
  let shown = isPanelShown(win, doc);
  const check = () => {
    const was = shown;
    shown = isPanelShown(win, doc);
    if (shown && !was) onShown();
    return shown;
  };
  const onEvent = () => void check();
  doc.addEventListener('visibilitychange', onEvent);
  win.addEventListener('resize', onEvent);
  return {
    check,
    stop() {
      doc.removeEventListener('visibilitychange', onEvent);
      win.removeEventListener('resize', onEvent);
    },
  };
}

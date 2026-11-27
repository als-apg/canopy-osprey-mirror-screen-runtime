// Whether this page is really on screen. `document.visibilityState` alone
// answers for the browser tab: inside a frame that a host page keeps loaded
// but hides (display: none), the document still reads "visible". Such a frame
// has a 0 x 0 viewport, so the page counts as shown only when the document is
// visible AND the window has a size. The size is read when asked, never
// cached: a hidden frame gets no rendering updates, so no observer can be
// trusted to report that it went away.

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

/**
 * Calls `onShown` each time the page comes back on screen: the document
 * becomes visible, or the window gets a size again (the host shows the frame).
 * Returns the unsubscribe.
 */
export function onPanelShown(
  onShown: () => void,
  win: PanelWindow = window,
  doc: PanelDocument = document
): () => void {
  let shown = isPanelShown(win, doc);
  const check = () => {
    const was = shown;
    shown = isPanelShown(win, doc);
    if (shown && !was) onShown();
  };
  doc.addEventListener('visibilitychange', check);
  win.addEventListener('resize', check);
  return () => {
    doc.removeEventListener('visibilitychange', check);
    win.removeEventListener('resize', check);
  };
}

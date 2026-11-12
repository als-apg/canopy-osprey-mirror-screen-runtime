// A small menu at a pointer position (an action button's choices, a device's
// right-click menu). It is portalled to the host's root, so it keeps its size
// at any zoom, is never clipped by the screen box and takes the host's theme
// tokens. Escape or a press outside it closes it; picking an item closes it
// and runs the item.

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';

// Host tokens (the OSPREY host contract) with Carbon and literal fallbacks.
const HOST = {
  bg: 'var(--canopy-host-bg-elevated, var(--cds-layer-01, #ffffff))',
  fg: 'var(--canopy-host-text-primary, var(--cds-text-primary, #161616))',
  border: 'var(--canopy-host-border, var(--cds-border-subtle-01, #c6c6c6))',
  hover: 'var(--canopy-host-hover-tint, rgba(141, 141, 141, 0.16))',
  ui: 'var(--canopy-host-font-ui, system-ui, sans-serif)',
  radius: 'var(--canopy-host-radius-md, 8px)',
  radiusSm: 'var(--canopy-host-radius-sm, 6px)',
  shadow: 'var(--canopy-host-shadow-dropdown, 0 4px 16px rgba(0, 0, 0, 0.18))',
  z: 'var(--canopy-host-z-dropdown, 1000)',
};

/** Where the menu opens: a pointer position in viewport coordinates. */
export interface MenuAnchor {
  readonly x: number;
  readonly y: number;
}

export interface MenuItem {
  readonly label: string;
  readonly run: () => void;
}

const MENU_WIDTH = 180;
const ITEM_HEIGHT = 30;

const MENU_STYLE: CSSProperties = {
  position: 'fixed',
  zIndex: HOST.z,
  minWidth: MENU_WIDTH - 20,
  padding: 4,
  background: HOST.bg,
  color: HOST.fg,
  border: `1px solid ${HOST.border}`,
  borderRadius: HOST.radius,
  boxShadow: HOST.shadow,
  font: `13px/1.35 ${HOST.ui}`,
};
const ITEM_STYLE: CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '5px 8px',
  border: 'none',
  borderRadius: HOST.radiusSm,
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  cursor: 'pointer',
};

export function PopupMenu(props: {
  anchor: MenuAnchor;
  items: readonly MenuItem[];
  close: () => void;
}) {
  return (
    <HostPortal>
      <MenuBody {...props} />
    </HostPortal>
  );
}

function MenuBody({
  anchor,
  items,
  close,
}: {
  anchor: MenuAnchor;
  items: readonly MenuItem[];
  close: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector('button')?.focus();
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [close]);
  const left = Math.min(anchor.x, window.innerWidth - MENU_WIDTH);
  const top = Math.min(anchor.y, window.innerHeight - (12 + ITEM_HEIGHT * items.length));
  return (
    <div ref={ref} role="menu" style={{ ...MENU_STYLE, left, top }}>
      {items.map((item, i) => (
        <button
          key={i}
          type="button"
          role="menuitem"
          style={{ ...ITEM_STYLE, background: hover === i ? HOST.hover : 'transparent' }}
          onMouseEnter={() => setHover(i)}
          onMouseLeave={() => setHover(null)}
          onClick={(e) => {
            // The portal still bubbles through the React tree to the widget's
            // own click handler, which would open its menu again.
            e.stopPropagation();
            close();
            item.run();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Renders `children` into the host root that encloses this point of the tree
 * (`[data-canopy-host-root]`), else into the page body. Nothing renders until
 * that root is found, after the first commit.
 */
function HostPortal({ children }: { children: ReactNode }) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [host, setHost] = useState<Element | null>(null);
  useEffect(() => {
    setHost(anchorRef.current?.closest('[data-canopy-host-root]') ?? document.body);
  }, []);
  return (
    <>
      <span ref={anchorRef} hidden />
      {host !== null && createPortal(children, host)}
    </>
  );
}

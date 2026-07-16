import { useState } from 'react';
import type { CSSProperties } from 'react';
import { useResolveAsset } from '../assets.js';
import type { WidgetRendererProps } from '../registry/WidgetRegistry.js';

// Map the IR `stretchMode` to a CSS object-fit value.
const OBJECT_FIT: Record<string, CSSProperties['objectFit']> = {
  none: 'none',
  fit: 'contain',
  fill: 'cover',
  stretch: 'fill',
};

/**
 * ScreenImage — renders an image from `props.filename`.
 *
 * Imported screens reference image *filenames*, not URLs; the filename is
 * mapped to a fetchable URL by the host's AssetResolverContext (identity by
 * default). A missing/broken src falls back to a labeled placeholder box
 * (filename + a note) rather than a bare broken-image glyph.
 */
export function ScreenImageWidget({ layout, props, isSelected }: WidgetRendererProps) {
  const filename = props.filename as string | undefined;
  const stretchMode = (props.stretchMode as string) ?? 'fit';
  const resolveAsset = useResolveAsset();
  const src = filename ? resolveAsset(filename) : undefined;

  // Track which src failed to load so a new src retries. Adjusting state during
  // render (the React-recommended pattern) avoids an effect that would trip
  // react-hooks/set-state-in-effect.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = src !== undefined && failedSrc === src;

  const outline = isSelected ? '2px solid #0f62fe' : 'none';

  if (!src || failed) {
    return (
      <div
        style={{
          width: layout.width,
          height: layout.height,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
          border: '1px dashed #6f6f6f',
          borderRadius: 2,
          color: '#8d8d8d',
          fontSize: 11,
          textAlign: 'center',
          overflow: 'hidden',
          padding: 4,
          boxSizing: 'border-box',
          outline,
          userSelect: 'none',
        }}
      >
        <span>🖼</span>
        <span style={{ wordBreak: 'break-all' }}>{filename ?? 'No image'}</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={filename}
      onError={() => setFailedSrc(src)}
      style={{
        width: layout.width,
        height: layout.height,
        objectFit: OBJECT_FIT[stretchMode] ?? 'contain',
        outline,
        display: 'block',
      }}
    />
  );
}

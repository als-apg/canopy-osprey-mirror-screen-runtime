// ECharts line plot of the configured curves, with live per-curve PV data.

import type { ComponentType, CSSProperties } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
// echarts-for-react is CJS; under NodeNext + verbatimModuleSyntax its default
// import isn't typed as a callable component, so resolve it at runtime below.
import * as EChartsReactModule from 'echarts-for-react';
import { usePV } from '@slaclab/canopy-react';

interface EChartsProps {
  option: unknown;
  style?: CSSProperties;
  opts?: { renderer?: 'svg' | 'canvas' };
  notMerge?: boolean;
}
const _mod = EChartsReactModule as unknown as { default?: unknown };
const ReactECharts = (_mod.default ?? EChartsReactModule) as ComponentType<EChartsProps>;
import type { WidgetRendererProps } from '../registry/WidgetRegistry.js';

interface CurveConfig {
  y_channel?: string;
  x_channel?: string | null;
  name?: string;
  color?: string;
  lineStyle?: number;
  lineWidth?: number;
  yAxisName?: string;
}

interface AxisConfig {
  name?: string;
  label?: string;
  orientation?: string;
}

// Maps PyDM's numeric lineStyle (Qt::PenStyle: 1 solid, 2 dash, 3 dot) to ECharts.
function dashFromLineStyle(style: number | undefined): 'solid' | 'dashed' | 'dotted' {
  if (style === 2) return 'dashed';
  if (style === 3 || style === 4) return 'dotted';
  return 'solid';
}

function asCurves(value: unknown): CurveConfig[] {
  if (!Array.isArray(value)) return [];
  return value.filter((c): c is CurveConfig => typeof c === 'object' && c !== null);
}

function asAxes(value: unknown): AxisConfig[] {
  if (!Array.isArray(value)) return [];
  return value.filter((a): a is AxisConfig => typeof a === 'object' && a !== null);
}

// PyDM plot titles are sometimes HTML; ECharts wants plain text.
function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, '').trim();
}

/** Coerce a PV value to a numeric array (waveform) — scalars become a 1-point series. */
function toNumberArray(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === 'number' ? v : Number(v)))
      .filter((n) => Number.isFinite(n));
  }
  if (typeof value === 'number' && Number.isFinite(value)) return [value];
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? [n] : [];
  }
  return [];
}

/** One live series: its y (and optional x) samples, keyed by curve index. */
interface CurveData {
  y: number[];
  x?: number[];
}

// A stable per-curve component (not a loop over usePV) so hook count stays
// constant across renders. Subscribes to one curve's channels and reports its
// latest arrays up by index; renders nothing.
function CurveSubscriber({
  index,
  yChannel,
  xChannel,
  onData,
}: {
  index: number;
  yChannel: string | undefined;
  xChannel: string | undefined;
  onData: (index: number, data: CurveData) => void;
}) {
  const yPV = usePV(yChannel);
  const xPV = usePV(xChannel ?? undefined);

  const y = yPV.connected ? toNumberArray(yPV.value) : [];
  const x = xChannel && xPV.connected ? toNumberArray(xPV.value) : undefined;

  // Report after render (not during); key on the samples so only real changes fire.
  const key = `${y.length}:${y[0] ?? ''}:${y[y.length - 1] ?? ''}:${x ? x.length : 'n'}`;
  useEffect(() => {
    onData(index, { y, x });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, key, onData]);
  return null;
}

export function WaveformPlot({ layout, props }: WidgetRendererProps) {
  const rawCurves = props.curves;
  const rawYAxes = props.yAxes;
  const title = props.title as string | undefined;
  const rawXLabels = props.xLabels;

  const curves = useMemo(() => asCurves(rawCurves), [rawCurves]);

  const [liveData, setLiveData] = useState<Record<number, CurveData>>({});
  const handleData = useCallback((index: number, data: CurveData) => {
    setLiveData((prev) => {
      const cur = prev[index];
      if (cur && cur.y === data.y && cur.x === data.x) return prev;
      return { ...prev, [index]: data };
    });
  }, []);

  const option = useMemo(() => {
    const yAxes = asAxes(rawYAxes);
    const xLabels = Array.isArray(rawXLabels) ? (rawXLabels as string[]) : [];
    const series = curves.map((c, i) => {
      const live = liveData[i];
      const y = live?.y ?? [];
      const x = live?.x;
      // [x, y] pairs when an x waveform is present, else y indexed by sample.
      const data = x && x.length === y.length ? y.map((v, j) => [x[j], v]) : y;
      return {
        name: c.name || c.y_channel || `Curve ${i + 1}`,
        type: 'line' as const,
        showSymbol: false,
        data,
        lineStyle: {
          color: c.color,
          width: c.lineWidth ?? 1,
          type: dashFromLineStyle(c.lineStyle),
        },
        itemStyle: { color: c.color },
      };
    });

    const anyX = curves.some((_c, i) => Boolean(liveData[i]?.x?.length));
    return {
      backgroundColor: 'transparent',
      animation: false,
      title: title
        ? { text: stripHtml(title), left: 'center', textStyle: { fontSize: 11 } }
        : undefined,
      grid: { left: 48, right: 16, top: title ? 32 : 16, bottom: 28 },
      tooltip: { trigger: 'axis' as const },
      xAxis: {
        type: (anyX ? 'value' : 'category') as 'value' | 'category',
        name: xLabels[0] ?? '',
        axisLabel: { fontSize: 9 },
      },
      yAxis: {
        type: 'value' as const,
        name: yAxes[0]?.label ?? '',
        axisLabel: { fontSize: 9 },
      },
      legend: series.length > 1 ? { bottom: 0, textStyle: { fontSize: 9 } } : undefined,
      series,
    };
  }, [curves, liveData, rawYAxes, title, rawXLabels]);

  return (
    <div style={{ width: layout.width, height: layout.height, overflow: 'hidden' }}>
      {curves.map((c, i) => (
        <CurveSubscriber
          key={i}
          index={i}
          yChannel={c.y_channel}
          xChannel={c.x_channel ?? undefined}
          onData={handleData}
        />
      ))}
      <ReactECharts
        option={option}
        style={{ width: '100%', height: '100%' }}
        opts={{ renderer: 'svg' }}
        notMerge
      />
    </div>
  );
}

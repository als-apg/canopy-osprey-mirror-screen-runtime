// What a node says on hover about a formula that feeds it. For a formula
// over many channels: how many members its vector tokens name, and which of
// them have no value (the summary comes with each result, from the server or
// from the in-page evaluator). For a formula that failed or never answered:
// what failed, never the summary of the result before.

import { useContext, useEffect, useMemo, useState } from 'react';
import { PVServiceContext } from '@slaclab/canopy-screen-widgets';
import { combineVectorInputs, type FormulaVectorInputs, type VectorSource } from '../formula.js';
import { isFormulaRef } from '../formulaRef.js';
import type { FormulaChannelData } from '../screenPV.js';

/** The hover text: `240 channels, 3 without a value: A, B, C +1 more`. */
export function vectorInputsText(inputs: FormulaVectorInputs): string {
  const channels = `${inputs.count} channel${inputs.count === 1 ? '' : 's'}`;
  const without = inputs.missing.length + inputs.more;
  if (without === 0) return `${channels}, ${inputs.count === 1 ? '' : 'all '}with a value`;
  const more = inputs.more > 0 ? ` +${inputs.more} more` : '';
  return `${channels}, ${without} without a value: ${inputs.missing.join(', ')}${more}`;
}

/** What the formulas feeding a node report: their members summaries, and what failed. */
export interface FormulaReport {
  readonly vectorSources: readonly VectorSource[];
  readonly problem: string | undefined;
}

/** The hover text of a node from the reports of its rules and of its channels. */
export function reportOf(...reports: readonly FormulaReport[]): {
  problem: string | undefined;
  vectorInputs: FormulaVectorInputs | undefined;
} {
  const problems = [...new Set(reports.flatMap((r) => r.problem ?? []))];
  return {
    problem: problems.length > 0 ? problems.join('; ') : undefined,
    vectorInputs: combineVectorInputs(reports.flatMap((r) => r.vectorSources)),
  };
}

const NONE: ReadonlyMap<string, FormulaChannelData> = new Map();

/**
 * The report of the `formula://` channels among `channels`, as their data
 * comes in. Other channels are not subscribed.
 */
export function useFormulaChannelReport(channels: readonly string[]): FormulaReport {
  const service = useContext(PVServiceContext);
  const refs = useMemo(() => [...new Set(channels.filter(isFormulaRef))], [channels]);
  const [byChannel, setByChannel] = useState(NONE);

  useEffect(() => {
    if (!service || refs.length === 0) return;
    const unsubscribes = refs.map((ref) =>
      service.subscribe(ref, (data) => {
        const next = data as FormulaChannelData;
        setByChannel((prev) => {
          const before = prev.get(ref);
          if (
            before?.vectorInputs === next.vectorInputs &&
            before?.formulaError === next.formulaError
          ) {
            return prev;
          }
          const map = new Map(prev);
          map.set(ref, next);
          return map;
        });
      })
    );
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
      setByChannel(NONE);
    };
  }, [service, refs]);

  return useMemo(() => {
    const data = refs.flatMap((ref) => byChannel.get(ref) ?? []);
    const problems = [...new Set(data.flatMap((d) => d.formulaError ?? []))];
    return {
      vectorSources: data.map((d) => ({
        members: d.vectorMembers ?? [],
        inputs: d.vectorInputs,
      })),
      problem: problems.length > 0 ? problems.join('; ') : undefined,
    };
  }, [refs, byChannel]);
}

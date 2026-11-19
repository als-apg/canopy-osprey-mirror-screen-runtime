// What a node says on hover about a formula over many channels that feeds
// it: how many members the formula's vector tokens name, and which of them
// have no value. The summary comes with each result (`vectorInputs`), from
// the server or from the in-page evaluator.

import { useContext, useEffect, useMemo, useState } from 'react';
import { PVServiceContext } from '@slaclab/canopy-screen-widgets';
import { combineVectorInputs, type FormulaVectorInputs } from '../formula.js';
import { isFormulaRef } from '../formulaRef.js';

/** The hover text: `240 channels, 3 without a value: A, B, C +1 more`. */
export function vectorInputsText(inputs: FormulaVectorInputs): string {
  const channels = `${inputs.count} channel${inputs.count === 1 ? '' : 's'}`;
  const without = inputs.missing.length + inputs.more;
  if (without === 0) return `${channels}, ${inputs.count === 1 ? '' : 'all '}with a value`;
  const more = inputs.more > 0 ? ` +${inputs.more} more` : '';
  return `${channels}, ${without} without a value: ${inputs.missing.join(', ')}${more}`;
}

const NONE: ReadonlyMap<string, FormulaVectorInputs | undefined> = new Map();

/**
 * The summary of the `formula://` channels among `channels`, as their results
 * come in. Other channels are not subscribed.
 */
export function useChannelVectorInputs(
  channels: readonly string[]
): FormulaVectorInputs | undefined {
  const service = useContext(PVServiceContext);
  const refs = useMemo(() => [...new Set(channels.filter(isFormulaRef))], [channels]);
  const [byChannel, setByChannel] = useState(NONE);

  useEffect(() => {
    if (!service || refs.length === 0) return;
    const unsubscribes = refs.map((ref) =>
      service.subscribe(ref, (data) => {
        const next = (data as { vectorInputs?: FormulaVectorInputs }).vectorInputs;
        setByChannel((prev) => {
          if (prev.get(ref) === next) return prev;
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

  return useMemo(
    () => combineVectorInputs(refs.map((ref) => byChannel.get(ref))),
    [refs, byChannel]
  );
}

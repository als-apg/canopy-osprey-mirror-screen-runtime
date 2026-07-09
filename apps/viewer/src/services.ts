// Composition root — the ONLY place concrete PV / formula services appear.
// Everything below App consumes them through context.

import { createContext, useContext } from 'react';
import type { PVService } from '@slaclab/canopy-client';
import { FoxFormulaService, HarePVService, MockPVService } from '@slaclab/canopy-client';
import type { FormulaSubscriber } from '@slaclab/canopy-screen-runtime';
import { createFoxFormulaSubscriber } from '@slaclab/canopy-screen-runtime';
import type { ViewerConfig } from './config.js';

export interface ViewerServices {
  pv: PVService;
  /** null in mock mode: rules stay inert (base props render unchanged). */
  formulas: FormulaSubscriber | null;
}

export function createServices(config: ViewerConfig): ViewerServices {
  if (config.pvMode === 'hare') {
    const pv = new HarePVService({
      url: `${config.canopyBaseUrl.replace(/^http/i, 'ws')}/hare/v1/ws/pvs`,
      apiKey: config.canopyApiKey,
    });
    pv.connect();
    const fox = new FoxFormulaService({
      baseUrl: config.canopyBaseUrl,
      apiKey: config.canopyApiKey,
    });
    fox.connect();
    return { pv, formulas: createFoxFormulaSubscriber(fox) };
  }

  const pv = new MockPVService();
  pv.connect();
  return { pv, formulas: null };
}

export const ServicesContext = createContext<ViewerServices | null>(null);

export function useServices(): ViewerServices {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('useServices must be used inside <ServicesContext.Provider>');
  return services;
}

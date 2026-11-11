import type { VoyageSea } from './public/js/components/voyage-sea/VoyageSea.js';
import type { VoyageHud } from './public/js/components/voyage-hud/VoyageHud.js';
import type { VoyageChart } from './public/js/components/voyage-chart/VoyageChart.js';
import type { VoyageLog } from './public/js/components/voyage-log/VoyageLog.js';

declare global {
  interface HTMLElementTagNameMap {
    'voyage-sea': VoyageSea;
    'voyage-hud': VoyageHud;
    'voyage-chart': VoyageChart;
    'voyage-log': VoyageLog;
  }
}

export {};

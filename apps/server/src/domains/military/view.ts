import {
  PVE_ENCOUNTERS,
  PVE_ENCOUNTER_IDS,
  armyPower,
  armyPopulation,
  type BattleReportView,
  type MilitaryView
} from '@siege/shared';
import type { BattleReportState, MilitaryState } from './service.js';

export function toBattleReportView(report: BattleReportState): BattleReportView {
  return {
    ...report,
    foughtAt: report.foughtAt.toISOString()
  };
}

export function toMilitaryView(state: MilitaryState): MilitaryView {
  return {
    army: {
      units: state.army,
      totalUnits: armyPopulation(state.army),
      power: armyPower(state.army)
    },
    encounters: PVE_ENCOUNTER_IDS.map((id) => {
      const encounter = PVE_ENCOUNTERS[id];
      const completed = state.completedEncounters.includes(id);
      const locked =
        encounter.prerequisite !== null &&
        !state.completedEncounters.includes(encounter.prerequisite);
      return { ...encounter, completed, locked };
    }),
    recentReports: state.reports.map(toBattleReportView)
  };
}

import { useState } from 'react';
import {
  PVE_ENCOUNTERS,
  UNIT_IDS,
  UNITS,
  unitRecruitmentCost,
  type CityView,
  type MilitaryView,
  type PveEncounterId,
  type UnitId
} from '@siege/shared';
import { apiErrorMessage } from '../App.js';
import { api } from '../api/client.js';

interface Props {
  city: CityView;
  military: MilitaryView;
  freeCitizens: number;
  onCityUpdated: (city: CityView) => void;
  onMilitaryUpdated: (military: MilitaryView) => void;
}

export function MilitaryPanel({
  city,
  military,
  freeCitizens,
  onCityUpdated,
  onMilitaryUpdated
}: Props) {
  const [quantities, setQuantities] = useState<Record<UnitId, number>>({ spearman: 1, archer: 1 });
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const barracksLevel = city.buildings.find((building) => building.buildingId === 'barracks')?.level ?? 0;

  const recruit = async (unitId: UnitId) => {
    setError(null);
    setPending(`recruit-${unitId}`);
    try {
      const result = await api.recruitUnits(city.id, unitId, quantities[unitId]);
      onCityUpdated(result.city);
      onMilitaryUpdated(result.military);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setPending(null);
    }
  };

  const attack = async (encounterId: PveEncounterId) => {
    setError(null);
    setPending(`attack-${encounterId}`);
    try {
      const result = await api.attackPve(encounterId);
      onCityUpdated(result.city);
      onMilitaryUpdated(result.military);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setPending(null);
    }
  };

  return (
    <section className="panel" aria-label="Army and PvE">
      <h2>Army &amp; Local Threats</h2>
      <p className="muted">
        {military.army.totalUnits} soldiers · {military.army.power} total power. Battles use the
        whole available army.
      </p>
      {error && <div className="error-box">{error}</div>}

      {barracksLevel === 0 ? (
        <p className="muted">Build a barracks after Town Hall level 2 to recruit soldiers.</p>
      ) : (
        <div className="unit-grid">
          {UNIT_IDS.map((unitId) => {
            const unit = UNITS[unitId];
            const quantity = quantities[unitId];
            const cost = unitRecruitmentCost(unitId, Math.max(1, quantity));
            return (
              <article key={unitId} className="unit-card">
                <header>
                  <h3>{unit.name}</h3>
                  <span className="level">Power {unit.power}</span>
                </header>
                <p className="muted">{unit.description}</p>
                <p>In army: {military.army.units[unitId]}</p>
                <label>
                  Quantity
                  <input
                    aria-label={`${unit.name} quantity`}
                    type="number"
                    min={1}
                    max={1000}
                    value={quantity}
                    onChange={(event) =>
                      setQuantities((current) => ({
                        ...current,
                        [unitId]: Math.max(0, Math.min(1000, Number(event.target.value) || 0))
                      }))
                    }
                  />
                </label>
                <p className="cost-row">
                  {Object.entries(cost).map(([resource, amount]) => (
                    <span className="cost" key={resource}>
                      {resource}: {amount}
                    </span>
                  ))}
                </p>
                <button
                  onClick={() => recruit(unitId)}
                  disabled={
                    pending !== null || quantity < 1 || quantity > freeCitizens
                  }
                >
                  Recruit {quantity}
                </button>
              </article>
            );
          })}
        </div>
      )}

      <div className="encounter-grid">
        {military.encounters.map((encounter) => {
          const definition = PVE_ENCOUNTERS[encounter.id];
          return (
            <article
              key={encounter.id}
              className={`encounter-card${encounter.completed ? ' completed' : ''}`}
            >
              <header>
                <h3>{encounter.name}</h3>
                <span className="level">Power {encounter.defenderPower}</span>
              </header>
              <p className="muted">{encounter.description}</p>
              <p className="cost-row">
                {Object.entries(encounter.reward).map(([resource, amount]) => (
                  <span className="cost" key={resource}>
                    {resource}: +{amount}
                  </span>
                ))}
              </p>
              <button
                onClick={() => attack(encounter.id)}
                disabled={
                  pending !== null ||
                  encounter.completed ||
                  encounter.locked ||
                  military.army.totalUnits === 0
                }
              >
                {encounter.completed
                  ? 'Cleared'
                  : encounter.locked
                    ? `Requires ${PVE_ENCOUNTERS[definition.prerequisite!].name}`
                    : 'Attack with all units'}
              </button>
            </article>
          );
        })}
      </div>

      {military.recentReports.length > 0 && (
        <div className="battle-reports">
          <h3>Recent battle reports</h3>
          <ul className="queue-list">
            {military.recentReports.map((report) => (
              <li className="queue-item" key={report.id}>
                <span>
                  {PVE_ENCOUNTERS[report.encounterId].name}: {report.victory ? 'Victory' : 'Defeat'} ·{' '}
                  {report.attackerPower} vs {report.defenderPower} power
                </span>
                <span className="muted">
                  Lost {report.unitsLost.spearman + report.unitsLost.archer}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

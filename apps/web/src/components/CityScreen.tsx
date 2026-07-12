import { useEffect, useMemo, useState } from 'react';
import {
  BUILDINGS,
  MAX_CONSTRUCTION_QUEUE_LENGTH,
  POPULATION,
  RESOURCE_IDS,
  TECHS,
  TECH_BRANCH_LABELS,
  TECH_IDS,
  advanceCity,
  techEffects,
  type BuildingId,
  type CityView,
  type MilitaryView,
  type ResourceAmounts,
  type TechId
} from '@siege/shared';
import { api } from '../api/client.js';
import { apiErrorMessage } from '../App.js';
import { BUILDING_LABELS, RESOURCE_LABELS } from '../labels.js';
import { CityScene } from './CityScene.js';
import { MilitaryPanel } from './MilitaryPanel.js';

interface Props {
  city: CityView;
  military: MilitaryView;
  onCityUpdated: (city: CityView) => void;
  onMilitaryUpdated: (military: MilitaryView) => void;
  onRefresh: () => Promise<void>;
}

/** Client-side clock offset so predictions follow server time. */
function useServerNow(serverTimeIso: string): number {
  const offset = useMemo(() => new Date(serverTimeIso).getTime() - Date.now(), [serverTimeIso]);
  const [nowMs, setNowMs] = useState(() => Date.now() + offset);
  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now() + offset), 1000);
    return () => clearInterval(interval);
  }, [offset]);
  return nowMs;
}

export function CityScreen({ city, military, onCityUpdated, onMilitaryUpdated, onRefresh }: Props) {
  const nowMs = useServerNow(city.serverTime);
  const [pendingBuilding, setPendingBuilding] = useState<BuildingId | null>(null);
  const [pendingWorkers, setPendingWorkers] = useState(false);
  const [pendingTech, setPendingTech] = useState<TechId | null>(null);
  const [error, setError] = useState<string | null>(null);

  // `?? []` guards against a cached pre-research API response (e.g. during HMR).
  const researchedTechs = city.researchedTechs ?? [];
  const effects = useMemo(() => techEffects(researchedTechs), [city.researchedTechs]);

  // Predicted state: the client runs the same shared simulation the server
  // uses, so the prediction matches; the server stays authoritative.
  const predicted = useMemo(
    () =>
      advanceCity(
        {
          amounts: city.resources.amounts,
          population: city.population.total,
          reservedPopulation: city.population.soldiers,
          nextArrivalAtMs: city.population.nextArrivalAt
            ? new Date(city.population.nextArrivalAt).getTime()
            : null,
          refTimeMs: new Date(city.serverTime).getTime()
        },
        city.buildings,
        nowMs,
        effects
      ),
    [city, nowMs, effects]
  );
  const predictedAmounts: ResourceAmounts = predicted.amounts;
  const workersAssigned = city.buildings.reduce((sum, b) => sum + b.workers, 0);
  const freeCitizens = Math.max(
    0,
    predicted.population - workersAssigned - city.population.soldiers
  );
  const famine = predictedAmounts.food <= 0 && predicted.ratesPerHour.food <= 0;

  // When a construction should have completed, fetch the authoritative state.
  useEffect(() => {
    const due = city.constructionQueue.some(
      (o) => o.completesAt !== null && new Date(o.completesAt).getTime() <= nowMs
    );
    if (due) {
      onRefresh().catch(() => undefined);
    }
  }, [city, nowMs, onRefresh]);

  const levels = new Map<BuildingId, number>(city.buildings.map((b) => [b.buildingId, b.level]));
  const effectiveLevels = new Map(levels);
  for (const order of city.constructionQueue) {
    effectiveLevels.set(
      order.buildingId,
      Math.max(effectiveLevels.get(order.buildingId) ?? 0, order.targetLevel)
    );
  }
  const queueFull =
    city.constructionQueue.length >= 1 + MAX_CONSTRUCTION_QUEUE_LENGTH + effects.extraQueueSlots;

  const startBuild = async (buildingId: BuildingId, plotIndex?: number) => {
    setError(null);
    setPendingBuilding(buildingId);
    try {
      const { city: updated } = await api.startConstruction(city.id, buildingId, plotIndex);
      onCityUpdated(updated);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setPendingBuilding(null);
    }
  };

  const research = async (techId: TechId) => {
    setError(null);
    setPendingTech(techId);
    try {
      const { city: updated } = await api.research(techId);
      onCityUpdated(updated);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setPendingTech(null);
    }
  };

  const changeWorkers = async (buildingId: BuildingId, delta: number) => {
    setError(null);
    setPendingWorkers(true);
    try {
      const allocation: Partial<Record<BuildingId, number>> = {};
      for (const building of city.buildings) {
        if (BUILDINGS[building.buildingId].production && building.level > 0) {
          allocation[building.buildingId] = building.workers;
        }
      }
      allocation[buildingId] = Math.max(0, (allocation[buildingId] ?? 0) + delta);
      const { city: updated } = await api.setWorkers(city.id, allocation);
      onCityUpdated(updated);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setPendingWorkers(false);
    }
  };

  return (
    <main className="city-screen">
      <section className="resource-bar" aria-label="Resources">
        {RESOURCE_IDS.map((resource) => (
          <div key={resource} className="resource">
            <span className="resource-name">{RESOURCE_LABELS[resource]}</span>
            <span className="resource-amount">{predictedAmounts[resource].toLocaleString()}</span>
            <span className={`resource-rate${predicted.ratesPerHour[resource] < 0 ? ' negative' : ''}`}>
              {formatRate(predicted.ratesPerHour[resource])}/h
            </span>
          </div>
        ))}
        <div className="resource storage">
          <span className="resource-name">Storage</span>
          <span className="resource-amount">{city.resources.storageCapacity.toLocaleString()}</span>
        </div>
      </section>

      {error && <div className="error-box">{error}</div>}

      <section className="panel" aria-label="Population">
        <h2>
          Population ({predicted.population}/{city.population.housingCapacity})
        </h2>
        <p className="muted">
          {workersAssigned} working · {freeCitizens} free citizens paying{' '}
          {freeCitizens * (POPULATION.taxCoinsPerFreeCitizenPerHour + effects.taxBonusPerFreeCitizen)}{' '}
          coins/h in taxes
        </p>
        <p className="muted">{city.population.soldiers} serving in the army</p>
        {famine ? (
          <p className="warning">Famine! The pantry is empty — nobody new will settle here.</p>
        ) : predicted.ratesPerHour.food < 0 ? (
          <p className="warning">
            Food is draining ({formatRate(predicted.ratesPerHour.food)}/h). Assign farm workers!
          </p>
        ) : null}
        {predicted.nextArrivalAtMs !== null &&
          predicted.population < city.population.housingCapacity &&
          !famine && (
            <p className="muted">
              Next citizen arrives in{' '}
              <Countdown targetMs={predicted.nextArrivalAtMs} nowMs={nowMs} />
            </p>
          )}
        {predicted.population >= city.population.housingCapacity && (
          <p className="muted">Housing is full — build or upgrade houses to grow.</p>
        )}
      </section>

      <section className="panel" aria-label="Construction queue">
        <h2>
          Construction ({city.constructionQueue.length}/
          {1 + MAX_CONSTRUCTION_QUEUE_LENGTH + effects.extraQueueSlots})
        </h2>
        {city.constructionQueue.length === 0 ? (
          <p className="muted">Nothing under construction. Your builders are idle!</p>
        ) : (
          <ul className="queue-list">
            {city.constructionQueue.map((order) => (
              <li key={order.id} className="queue-item">
                <span>
                  {BUILDING_LABELS[order.buildingId]} → level {order.targetLevel}
                </span>
                {order.status === 'IN_PROGRESS' && order.completesAt ? (
                  <Countdown targetMs={new Date(order.completesAt).getTime()} nowMs={nowMs} />
                ) : (
                  <span className="muted">queued</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel" aria-label="Research">
        <h2>Research</h2>
        {!levels.has('academy') && researchedTechs.length === 0 ? (
          <p className="muted">Build an academy and assign scientists to produce knowledge.</p>
        ) : (
          <div className="tech-grid">
            {TECH_IDS.map((techId) => {
              const tech = TECHS[techId];
              const researched = researchedTechs.includes(techId);
              const prereqMissing =
                tech.prerequisite !== null && !researchedTechs.includes(tech.prerequisite);
              const affordable = predictedAmounts.knowledge >= tech.knowledgeCost;
              return (
                <article key={techId} className={`tech-card${researched ? ' researched' : ''}`}>
                  <header>
                    <h3>{tech.name}</h3>
                    <span className="level">{TECH_BRANCH_LABELS[tech.branch]}</span>
                  </header>
                  <p className="muted">{tech.description}</p>
                  {researched ? (
                    <p className="tech-done">Researched ✓</p>
                  ) : (
                    <button
                      onClick={() => research(techId)}
                      disabled={pendingTech !== null || prereqMissing || !affordable}
                    >
                      {prereqMissing
                        ? `Requires ${TECHS[tech.prerequisite!].name}`
                        : `Research (${tech.knowledgeCost} knowledge)`}
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <CityScene
        city={city}
        effects={effects}
        predictedAmounts={predictedAmounts}
        freeCitizens={freeCitizens}
        nowMs={nowMs}
        pending={pendingBuilding !== null || pendingWorkers}
        queueFull={queueFull}
        onBuild={startBuild}
        onUpgrade={startBuild}
        onChangeWorkers={changeWorkers}
      />

      <MilitaryPanel
        city={city}
        military={military}
        freeCitizens={freeCitizens}
        onCityUpdated={onCityUpdated}
        onMilitaryUpdated={onMilitaryUpdated}
      />
    </main>
  );
}

function Countdown({ targetMs, nowMs }: { targetMs: number; nowMs: number }) {
  const remaining = Math.max(0, Math.ceil((targetMs - nowMs) / 1000));
  return <span className="countdown">{formatDuration(remaining)}</span>;
}

function formatRate(rate: number): string {
  return rate >= 0 ? `+${rate}` : `${rate}`;
}

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

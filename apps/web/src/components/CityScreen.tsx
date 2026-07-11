import { useEffect, useMemo, useState } from 'react';
import {
  BUILDINGS,
  BUILDING_IDS,
  MAX_CONSTRUCTION_QUEUE_LENGTH,
  RESOURCE_IDS,
  buildingLevelCost,
  buildingLevelSeconds,
  canAfford,
  checkBuildingPrerequisites,
  currentAmounts,
  type BuildingId,
  type CityView,
  type ResourceAmounts
} from '@siege/shared';
import { api } from '../api/client.js';
import { apiErrorMessage } from '../App.js';

interface Props {
  city: CityView;
  onCityUpdated: (city: CityView) => void;
  onRefresh: () => Promise<void>;
}

const RESOURCE_LABELS: Record<string, string> = {
  wood: 'Wood',
  stone: 'Stone',
  food: 'Food',
  iron: 'Iron',
  coins: 'Coins'
};

const BUILDING_LABELS: Record<BuildingId, string> = {
  townHall: 'Town Hall',
  warehouse: 'Warehouse',
  sawmill: 'Sawmill',
  quarry: 'Quarry',
  farm: 'Farm',
  ironMine: 'Iron Mine'
};

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

export function CityScreen({ city, onCityUpdated, onRefresh }: Props) {
  const nowMs = useServerNow(city.serverTime);
  const [pendingBuilding, setPendingBuilding] = useState<BuildingId | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Predicted amounts: client displays a prediction, the server stays authoritative.
  const predictedAmounts: ResourceAmounts = useMemo(
    () =>
      currentAmounts(
        {
          amounts: city.resources.amounts,
          ratesPerHour: city.resources.ratesPerHour,
          refTimeMs: new Date(city.serverTime).getTime(),
          storageCapacity: city.resources.storageCapacity
        },
        nowMs
      ),
    [city, nowMs]
  );

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
  const queueFull = city.constructionQueue.length >= 1 + MAX_CONSTRUCTION_QUEUE_LENGTH;

  const startBuild = async (buildingId: BuildingId) => {
    setError(null);
    setPendingBuilding(buildingId);
    try {
      const { city: updated } = await api.startConstruction(city.id, buildingId);
      onCityUpdated(updated);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setPendingBuilding(null);
    }
  };

  return (
    <main className="city-screen">
      <section className="resource-bar" aria-label="Resources">
        {RESOURCE_IDS.map((resource) => (
          <div key={resource} className="resource">
            <span className="resource-name">{RESOURCE_LABELS[resource]}</span>
            <span className="resource-amount">{predictedAmounts[resource].toLocaleString()}</span>
            <span className="resource-rate">+{city.resources.ratesPerHour[resource]}/h</span>
          </div>
        ))}
        <div className="resource storage">
          <span className="resource-name">Storage</span>
          <span className="resource-amount">{city.resources.storageCapacity.toLocaleString()}</span>
        </div>
      </section>

      {error && <div className="error-box">{error}</div>}

      <section className="panel" aria-label="Construction queue">
        <h2>
          Construction ({city.constructionQueue.length}/{1 + MAX_CONSTRUCTION_QUEUE_LENGTH})
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

      <section className="panel" aria-label="Buildings">
        <h2>{city.name}</h2>
        <div className="building-grid">
          {BUILDING_IDS.map((buildingId) => {
            const def = BUILDINGS[buildingId];
            const level = levels.get(buildingId) ?? 0;
            const effectiveLevel = effectiveLevels.get(buildingId) ?? 0;
            const targetLevel = effectiveLevel + 1;
            const prereqFailure =
              targetLevel > def.maxLevel
                ? { kind: 'maxLevelReached' as const, buildingId }
                : checkBuildingPrerequisites(buildingId, targetLevel, effectiveLevels);
            const cost = targetLevel <= def.maxLevel ? buildingLevelCost(def, targetLevel) : {};
            const affordable = canAfford(predictedAmounts, cost);
            const seconds = targetLevel <= def.maxLevel ? buildingLevelSeconds(def, targetLevel) : 0;
            const disabled =
              pendingBuilding !== null || queueFull || prereqFailure !== null || !affordable;

            return (
              <article key={buildingId} className={`building-card${level > 0 ? '' : ' unbuilt'}`}>
                <header>
                  <h3>{BUILDING_LABELS[buildingId]}</h3>
                  <span className="level">{level > 0 ? `Lv ${level}` : 'Not built'}</span>
                </header>
                {def.production && (
                  <p className="muted">
                    Produces {RESOURCE_LABELS[def.production.resource]}
                    {level > 0 && ` (+${city.resources.ratesPerHour[def.production.resource]}/h city total)`}
                  </p>
                )}
                {def.storage && <p className="muted">Increases storage capacity</p>}
                <div className="cost-row">
                  {Object.entries(cost).map(([resource, amount]) => (
                    <span
                      key={resource}
                      className={
                        predictedAmounts[resource as keyof ResourceAmounts] >= (amount ?? 0)
                          ? 'cost'
                          : 'cost insufficient'
                      }
                    >
                      {RESOURCE_LABELS[resource]}: {amount}
                    </span>
                  ))}
                  {seconds > 0 && <span className="cost">⏱ {formatDuration(seconds)}</span>}
                </div>
                <button onClick={() => startBuild(buildingId)} disabled={disabled}>
                  {buttonLabel(effectiveLevel, targetLevel, def.maxLevel, prereqFailure, queueFull)}
                </button>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}

function buttonLabel(
  level: number,
  targetLevel: number,
  maxLevel: number,
  prereqFailure: ReturnType<typeof checkBuildingPrerequisites>,
  queueFull: boolean
): string {
  if (targetLevel > maxLevel) return 'Max level';
  if (prereqFailure?.kind === 'missingPrerequisite') {
    return `Requires ${BUILDING_LABELS[prereqFailure.buildingId]} ${prereqFailure.requiredLevel}`;
  }
  if (queueFull) return 'Queue full';
  return level > 0 ? `Upgrade to Lv ${targetLevel}` : 'Build';
}

function Countdown({ targetMs, nowMs }: { targetMs: number; nowMs: number }) {
  const remaining = Math.max(0, Math.ceil((targetMs - nowMs) / 1000));
  return <span className="countdown">{formatDuration(remaining)}</span>;
}

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

import { useState } from 'react';
import {
  BUILDINGS,
  BUILDING_IDS,
  CITY_PLOTS,
  SCENE_ASPECT,
  buildingLevelCost,
  buildingLevelSeconds,
  buildingWorkerSlots,
  canAfford,
  checkBuildingPrerequisites,
  plotCenter,
  plotPolygonPoints,
  type BuildingId,
  type CityView,
  type ResourceAmounts,
  type TechEffects
} from '@siege/shared';
import { BUILDING_ICONS, BUILDING_LABELS, RESOURCE_LABELS } from '../labels.js';
import townScene from '../assets/town-scene.jpg';

interface Props {
  city: CityView;
  effects: TechEffects;
  predictedAmounts: ResourceAmounts;
  freeCitizens: number;
  nowMs: number;
  pending: boolean;
  queueFull: boolean;
  onBuild: (buildingId: BuildingId, plotIndex: number) => void;
  onUpgrade: (buildingId: BuildingId) => void;
  onChangeWorkers: (buildingId: BuildingId, delta: number) => void;
}

export function CityScene({
  city,
  effects,
  predictedAmounts,
  freeCitizens,
  nowMs,
  pending,
  queueFull,
  onBuild,
  onUpgrade,
  onChangeWorkers
}: Props) {
  const [selectedPlot, setSelectedPlot] = useState<number | null>(null);

  const buildingByPlot = new Map(city.buildings.map((b) => [b.plotIndex, b]));
  const levels = new Map<BuildingId, number>(city.buildings.map((b) => [b.buildingId, b.level]));
  const effectiveLevels = new Map(levels);
  for (const order of city.constructionQueue) {
    effectiveLevels.set(
      order.buildingId,
      Math.max(effectiveLevels.get(order.buildingId) ?? 0, order.targetLevel)
    );
  }
  const newBuildOrderByPlot = new Map(
    city.constructionQueue.filter((o) => o.plotIndex !== null).map((o) => [o.plotIndex, o])
  );
  const upgradeOrderByBuilding = new Map(
    city.constructionQueue.filter((o) => o.plotIndex === null).map((o) => [o.buildingId, o])
  );

  const viewHeight = 100 * SCENE_ASPECT;
  const selected = selectedPlot !== null ? CITY_PLOTS[selectedPlot] : null;

  return (
    <section className="panel city-scene-panel" aria-label="City">
      <h2>{city.name}</h2>
      <div className="city-scene">
        <img src={townScene} alt="" className="city-scene-image" draggable={false} />
        <svg
          className="city-scene-overlay"
          viewBox={`0 0 100 ${viewHeight}`}
          preserveAspectRatio="none"
        >
          {CITY_PLOTS.map((plot) => {
            const building = buildingByPlot.get(plot.id);
            const newOrder = newBuildOrderByPlot.get(plot.id);
            const upgradeOrder = building ? upgradeOrderByBuilding.get(building.buildingId) : undefined;
            const points = plotPolygonPoints(plot)
              .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
              .join(' ');
            const [cx, cy] = plotCenter(plot);
            const label = building
              ? `Plot ${plot.id}: ${BUILDING_LABELS[building.buildingId]} level ${building.level}`
              : newOrder
                ? `Plot ${plot.id}: ${BUILDING_LABELS[newOrder.buildingId]} under construction`
                : `Plot ${plot.id}: empty`;
            const classes = ['plot'];
            if (building) classes.push('plot-built');
            if (newOrder) classes.push('plot-reserved');
            if (selectedPlot === plot.id) classes.push('plot-selected');

            return (
              <g key={plot.id}>
                <polygon
                  className={classes.join(' ')}
                  points={points}
                  role="button"
                  tabIndex={0}
                  aria-label={label}
                  onClick={() => setSelectedPlot(selectedPlot === plot.id ? null : plot.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedPlot(selectedPlot === plot.id ? null : plot.id);
                    }
                  }}
                />
                {building && (
                  <>
                    <text className="plot-icon" x={cx} y={cy + 0.8} textAnchor="middle">
                      {BUILDING_ICONS[building.buildingId]}
                    </text>
                    <text className="plot-level" x={cx} y={cy + 3.6} textAnchor="middle">
                      {BUILDING_LABELS[building.buildingId]} {building.level}
                    </text>
                    {upgradeOrder && (
                      <text className="plot-hammer" x={cx + 3.4} y={cy - 2.2} textAnchor="middle">
                        🔨
                      </text>
                    )}
                  </>
                )}
                {newOrder && (
                  <>
                    <text className="plot-icon" x={cx} y={cy + 0.8} textAnchor="middle">
                      🔨
                    </text>
                    <text className="plot-level" x={cx} y={cy + 3.6} textAnchor="middle">
                      {BUILDING_LABELS[newOrder.buildingId]}
                      {newOrder.completesAt
                        ? ` ${formatDuration(Math.max(0, Math.ceil((new Date(newOrder.completesAt).getTime() - nowMs) / 1000)))}`
                        : ' queued'}
                    </text>
                  </>
                )}
              </g>
            );
          })}
        </svg>

        {selected && (
          <div
            className="plot-popup"
            style={popupPosition(selected.x, selected.y)}
            role="dialog"
            aria-label={`Plot ${selected.id}`}
          >
            <button className="popup-close" aria-label="Close" onClick={() => setSelectedPlot(null)}>
              ×
            </button>
            {renderPopupContent(selected.id)}
          </div>
        )}
      </div>
    </section>
  );

  function popupPosition(x: number, y: number): React.CSSProperties {
    // Keep the popup inside the scene: flip side for edge plots.
    const style: React.CSSProperties = {};
    if (x < 50) style.left = `${x + 9}%`;
    else style.right = `${100 - x + 9}%`;
    if (y < 60) style.top = `${y}%`;
    else style.bottom = `${100 - y}%`;
    return style;
  }

  function renderPopupContent(plotId: number) {
    const building = buildingByPlot.get(plotId);
    const newOrder = newBuildOrderByPlot.get(plotId);

    if (newOrder) {
      return (
        <p className="muted">
          {BUILDING_LABELS[newOrder.buildingId]} is under construction here.
        </p>
      );
    }

    if (building) {
      const def = BUILDINGS[building.buildingId];
      const upgradeOrder = upgradeOrderByBuilding.get(building.buildingId);
      const effectiveLevel = effectiveLevels.get(building.buildingId) ?? building.level;
      const targetLevel = effectiveLevel + 1;
      const atMax = targetLevel > def.maxLevel;
      const prereqFailure = atMax
        ? null
        : checkBuildingPrerequisites(building.buildingId, targetLevel, effectiveLevels);
      const cost = atMax ? {} : buildingLevelCost(def, targetLevel);
      const affordable = canAfford(predictedAmounts, cost);
      const seconds = atMax ? 0 : buildingLevelSeconds(def, targetLevel);
      const slots = buildingWorkerSlots(def, building.level, effects);

      return (
        <>
          <h3>
            {BUILDING_ICONS[building.buildingId]} {BUILDING_LABELS[building.buildingId]}{' '}
            <span className="level">Lv {building.level}</span>
          </h3>
          {def.production && (
            <p className="muted">
              Produces {RESOURCE_LABELS[def.production.resource]} (+
              {building.workers * (def.production.perWorkerPerHour + (building.buildingId === 'sawmill' || building.buildingId === 'quarry' ? effects.woodStonePerWorkerBonus : 0))}
              /h from {building.workers} worker{building.workers === 1 ? '' : 's'})
            </p>
          )}
          {def.storage && <p className="muted">Increases storage capacity</p>}
          {def.housing && <p className="muted">Houses {def.housing.perLevel + (building.buildingId === 'house' ? effects.houseExtraHousingPerLevel : 0)} citizens per level</p>}
          {def.production && (
            <div className="worker-row" aria-label={`${BUILDING_LABELS[building.buildingId]} workers`}>
              <button
                className="worker-btn"
                onClick={() => onChangeWorkers(building.buildingId, -1)}
                disabled={pending || building.workers <= 0}
                aria-label={`Remove worker from ${BUILDING_LABELS[building.buildingId]}`}
              >
                −
              </button>
              <span className="worker-count">
                {building.workers}/{slots} workers
              </span>
              <button
                className="worker-btn"
                onClick={() => onChangeWorkers(building.buildingId, 1)}
                disabled={pending || building.workers >= slots || freeCitizens <= 0}
                aria-label={`Add worker to ${BUILDING_LABELS[building.buildingId]}`}
              >
                +
              </button>
            </div>
          )}
          {upgradeOrder ? (
            <p className="muted">Upgrade to Lv {upgradeOrder.targetLevel} in progress…</p>
          ) : (
            <>
              {!atMax && (
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
              )}
              <button
                onClick={() => onUpgrade(building.buildingId)}
                disabled={pending || atMax || queueFull || prereqFailure !== null || !affordable}
              >
                {atMax
                  ? 'Max level'
                  : prereqFailure?.kind === 'missingPrerequisite'
                    ? `Requires ${BUILDING_LABELS[prereqFailure.buildingId]} ${prereqFailure.requiredLevel}`
                    : queueFull
                      ? 'Queue full'
                      : `Upgrade to Lv ${targetLevel}`}
              </button>
            </>
          )}
        </>
      );
    }

    // Empty plot: offer every building the city does not have yet.
    const buildable = BUILDING_IDS.filter((id) => (effectiveLevels.get(id) ?? 0) === 0);
    return (
      <>
        <h3>Empty plot</h3>
        {buildable.length === 0 ? (
          <p className="muted">Every building type already stands in your city.</p>
        ) : (
          <ul className="build-options">
            {buildable.map((buildingId) => {
              const def = BUILDINGS[buildingId];
              const prereqFailure = checkBuildingPrerequisites(buildingId, 1, effectiveLevels);
              const cost = buildingLevelCost(def, 1);
              const affordable = canAfford(predictedAmounts, cost);
              return (
                <li key={buildingId} className="build-option">
                  <div>
                    <strong>
                      {BUILDING_ICONS[buildingId]} {BUILDING_LABELS[buildingId]}
                    </strong>
                    <span className="cost-row">
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
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      onBuild(buildingId, plotId);
                      setSelectedPlot(null);
                    }}
                    disabled={pending || queueFull || prereqFailure !== null || !affordable}
                  >
                    {prereqFailure?.kind === 'missingPrerequisite'
                      ? `Requires ${BUILDING_LABELS[prereqFailure.buildingId]} ${prereqFailure.requiredLevel}`
                      : queueFull
                        ? 'Queue full'
                        : 'Build'}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </>
    );
  }
}

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

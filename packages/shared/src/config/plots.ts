import type { BuildingId } from './buildings.js';

/**
 * Building plots of the city scene (design doc 12.1: fixed but expandable
 * building area with clear plots).
 *
 * Coordinates are percentages of the city scene image (town2 artwork),
 * calibrated against the hex field inside the walls. `r` is the horizontal
 * hex radius; the vertical radius is `r × PLOT_ASPECT` because the scene is
 * drawn from an elevated camera angle.
 */
export interface CityPlotDefinition {
  id: number;
  /** Hex centre, % of scene width. */
  x: number;
  /** Hex centre, % of scene height. */
  y: number;
  /** Horizontal hex radius, % of scene width. */
  r: number;
}

/** Vertical squash of the perspective hexes. */
export const PLOT_ASPECT = 0.62;

/** Scene image aspect ratio (height / width) — town2 artwork is 1672×941. */
export const SCENE_ASPECT = 941 / 1672;

export const CITY_PLOTS: readonly CityPlotDefinition[] = [
  { id: 0, x: 40.2, y: 23, r: 8 },
  { id: 1, x: 55.2, y: 22.8, r: 8 },
  { id: 2, x: 70, y: 23, r: 8 },
  { id: 3, x: 33, y: 33.5, r: 8 },
  { id: 4, x: 48, y: 33.2, r: 8 },
  { id: 5, x: 62.8, y: 33.2, r: 8 },
  { id: 6, x: 77.5, y: 34, r: 8 },
  { id: 7, x: 25.5, y: 44.5, r: 8 },
  { id: 8, x: 40.5, y: 44.2, r: 8 },
  { id: 9, x: 55.3, y: 44, r: 8 },
  { id: 10, x: 70, y: 44, r: 8 },
  { id: 11, x: 18, y: 55.3, r: 8 },
  { id: 12, x: 33, y: 55, r: 8 },
  { id: 13, x: 48, y: 55, r: 8 },
  { id: 14, x: 62.8, y: 54.8, r: 8 },
  { id: 15, x: 77.5, y: 54.8, r: 8 },
  { id: 16, x: 25.5, y: 65.8, r: 8 },
  { id: 17, x: 40.5, y: 65.6, r: 8 },
  { id: 18, x: 55.3, y: 65.5, r: 8 },
  { id: 19, x: 70, y: 65.5, r: 8 },
  { id: 20, x: 33, y: 77.2, r: 8 },
  { id: 21, x: 48, y: 77, r: 8 },
  { id: 22, x: 62.8, y: 76.8, r: 8 },
  { id: 23, x: 71, y: 83.3, r: 8 }
];

/** Plots the starting buildings occupy (central, near the north gate road). */
export const STARTING_PLOT_ASSIGNMENT: Readonly<Partial<Record<BuildingId, number>>> = {
  townHall: 9,
  sawmill: 8,
  farm: 13
};

/**
 * Deterministic plots for buildings that existed before the plot system
 * (dev/test databases): every building id has a reserved default plot, so a
 * backfill can never collide. Also used as the fallback when the client does
 * not pick a plot for a new building.
 */
export const DEFAULT_PLOT_ASSIGNMENT: Readonly<Record<BuildingId, number>> = {
  townHall: 9,
  sawmill: 8,
  farm: 13,
  warehouse: 4,
  house: 14,
  quarry: 12,
  ironMine: 17,
  academy: 10,
  barracks: 18
};

/**
 * SVG polygon points for a plot in a `viewBox="0 0 100 ${100 * SCENE_ASPECT}"`
 * coordinate system (both axes in scene-width units, so the perspective
 * squash is a plain multiplier).
 */
export function plotPolygonPoints(plot: CityPlotDefinition): [number, number][] {
  const cy = plot.y * SCENE_ASPECT;
  const points: [number, number][] = [];
  for (let k = 0; k < 6; k++) {
    const angle = (Math.PI / 180) * (60 * k - 30);
    points.push([
      plot.x + plot.r * Math.cos(angle),
      cy + plot.r * PLOT_ASPECT * Math.sin(angle)
    ]);
  }
  return points;
}

/** Plot centre in the same viewBox units as `plotPolygonPoints`. */
export function plotCenter(plot: CityPlotDefinition): [number, number] {
  return [plot.x, plot.y * SCENE_ASPECT];
}

import type { BuildingId } from '@siege/shared';

export const RESOURCE_LABELS: Record<string, string> = {
  wood: 'Wood',
  stone: 'Stone',
  food: 'Food',
  iron: 'Iron',
  coins: 'Coins',
  knowledge: 'Knowledge'
};

export const BUILDING_LABELS: Record<BuildingId, string> = {
  townHall: 'Town Hall',
  warehouse: 'Warehouse',
  house: 'House',
  sawmill: 'Sawmill',
  quarry: 'Quarry',
  farm: 'Farm',
  ironMine: 'Iron Mine',
  academy: 'Academy',
  barracks: 'Barracks'
};

/** Placeholder markers until the asset pipeline delivers real sprites. */
export const BUILDING_ICONS: Record<BuildingId, string> = {
  townHall: '🏛',
  warehouse: '📦',
  house: '🏠',
  sawmill: '🪵',
  quarry: '⛰',
  farm: '🌾',
  ironMine: '⛏',
  academy: '📜',
  barracks: '🛡'
};

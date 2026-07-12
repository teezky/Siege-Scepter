import type { BuildingId } from '../config/buildings.js';
import type { PveEncounterId, UnitCounts, UnitId } from '../config/military.js';
import type { TechId } from '../config/research.js';
import type { ResourceAmounts } from '../config/resources.js';

/**
 * API contract types shared between server and web client.
 * The server maps domain results to these; the client renders them.
 * These are NOT database entities (project instructions section 32).
 */

export interface ApiError {
  code:
    | 'INSUFFICIENT_RESOURCES'
    | 'UNMET_PREREQUISITE'
    | 'QUEUE_FULL'
    | 'INVALID_STATE'
    | 'PERMISSION_DENIED'
    | 'VALIDATION_FAILED'
    | 'RATE_LIMITED'
    | 'CONFLICT'
    | 'NOT_FOUND'
    | 'UNAUTHENTICATED'
    | 'INTERNAL';
  message: string;
  details?: Record<string, unknown>;
}

export interface PlayerView {
  id: string;
  username: string;
}

export interface CityBuildingView {
  buildingId: BuildingId;
  level: number;
  /** Workers assigned to this building (always 0 for non-production buildings). */
  workers: number;
  /** Worker slots available at the current level (0 for non-production buildings). */
  workerSlots: number;
  /** Which city plot this building stands on. */
  plotIndex: number;
}

export interface CityPopulationView {
  total: number;
  housingCapacity: number;
  /** Citizens not assigned as workers; they pay taxes. */
  freeCitizens: number;
  /** Citizens currently serving in the army. */
  soldiers: number;
  /** ISO timestamp of the next citizen arrival; null while housing is full. */
  nextArrivalAt: string | null;
}

export type ConstructionStatus = 'QUEUED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export interface ConstructionOrderView {
  id: string;
  buildingId: BuildingId;
  targetLevel: number;
  status: ConstructionStatus;
  queuePosition: number;
  /** Plot reserved for a brand-new building; null for upgrades. */
  plotIndex: number | null;
  /** ISO timestamps; null while still queued. */
  startedAt: string | null;
  completesAt: string | null;
}

export interface CityResourcesView {
  /** Authoritative amounts at serverTime. */
  amounts: ResourceAmounts;
  /** Net rates: worker production, minus food upkeep, plus taxes. */
  ratesPerHour: ResourceAmounts;
  storageCapacity: number;
}

export interface CityView {
  id: string;
  name: string;
  buildings: CityBuildingView[];
  resources: CityResourcesView;
  population: CityPopulationView;
  constructionQueue: ConstructionOrderView[];
  /** Technologies the owning player has researched (player-global). */
  researchedTechs: TechId[];
  /** Server clock at response time (ISO), for client-side prediction. */
  serverTime: string;
}

export interface RegisterRequest {
  username: string;
  password: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface AuthResponse {
  player: PlayerView;
}

export interface StartConstructionRequest {
  buildingId: BuildingId;
  /**
   * Plot for a BRAND-NEW building (ignored for upgrades). Optional: the
   * server falls back to the building's default plot when free.
   */
  plotIndex?: number;
}

export interface StartConstructionResponse {
  city: CityView;
  order: ConstructionOrderView;
}

/** Full replacement of worker assignments for the city's production buildings. */
export interface SetWorkersRequest {
  allocation: Partial<Record<BuildingId, number>>;
}

export interface SetWorkersResponse {
  city: CityView;
}

export interface ResearchTechRequest {
  techId: TechId;
}

export interface ResearchTechResponse {
  city: CityView;
}

export interface ArmyView {
  units: UnitCounts;
  totalUnits: number;
  power: number;
}

export interface PveEncounterView {
  id: PveEncounterId;
  name: string;
  description: string;
  defenderPower: number;
  reward: Partial<Record<keyof ResourceAmounts, number>>;
  prerequisite: PveEncounterId | null;
  completed: boolean;
  locked: boolean;
}

export interface BattleReportView {
  id: string;
  encounterId: PveEncounterId;
  victory: boolean;
  attackerPower: number;
  defenderPower: number;
  unitsSent: UnitCounts;
  unitsLost: UnitCounts;
  reward: Partial<Record<keyof ResourceAmounts, number>>;
  foughtAt: string;
}

export interface MilitaryView {
  army: ArmyView;
  encounters: PveEncounterView[];
  recentReports: BattleReportView[];
}

export interface RecruitUnitsRequest {
  unitId: UnitId;
  quantity: number;
}

export interface RecruitUnitsResponse {
  city: CityView;
  military: MilitaryView;
}

export interface AttackPveResponse {
  city: CityView;
  military: MilitaryView;
  report: BattleReportView;
}

import type { BuildingId } from '../config/buildings.js';
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
}

export interface CityPopulationView {
  total: number;
  housingCapacity: number;
  /** Citizens not assigned as workers; they pay taxes. */
  freeCitizens: number;
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

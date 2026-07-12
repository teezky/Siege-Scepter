import type {
  ApiError,
  AttackPveResponse,
  AuthResponse,
  BuildingId,
  CityView,
  LoginRequest,
  MilitaryView,
  RegisterRequest,
  ResearchTechResponse,
  RecruitUnitsResponse,
  SetWorkersResponse,
  StartConstructionResponse,
  TechId,
  UnitId
} from '@siege/shared';

export class ApiRequestError extends Error {
  constructor(readonly apiError: ApiError, readonly status: number) {
    super(apiError.message);
    this.name = 'ApiRequestError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    ...(init?.body ? { headers: { 'Content-Type': 'application/json' } } : {})
  });
  if (!response.ok) {
    let apiError: ApiError = { code: 'INTERNAL', message: 'Unexpected server error' };
    try {
      const body = (await response.json()) as { error?: ApiError };
      if (body.error) apiError = body.error;
    } catch {
      // keep fallback error
    }
    throw new ApiRequestError(apiError, response.status);
  }
  return (await response.json()) as T;
}

export const api = {
  register: (payload: RegisterRequest) =>
    request<AuthResponse>('/api/auth/register', { method: 'POST', body: JSON.stringify(payload) }),
  login: (payload: LoginRequest) =>
    request<AuthResponse>('/api/auth/login', { method: 'POST', body: JSON.stringify(payload) }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  me: () => request<AuthResponse>('/api/auth/me'),
  getCity: () => request<{ city: CityView }>('/api/city'),
  getMilitary: () => request<{ military: MilitaryView }>('/api/military'),
  startConstruction: (cityId: string, buildingId: string, plotIndex?: number) =>
    request<StartConstructionResponse>(`/api/cities/${cityId}/constructions`, {
      method: 'POST',
      body: JSON.stringify(plotIndex === undefined ? { buildingId } : { buildingId, plotIndex })
    }),
  setWorkers: (cityId: string, allocation: Partial<Record<BuildingId, number>>) =>
    request<SetWorkersResponse>(`/api/cities/${cityId}/workers`, {
      method: 'PUT',
      body: JSON.stringify({ allocation })
    }),
  research: (techId: TechId) =>
    request<ResearchTechResponse>('/api/research', {
      method: 'POST',
      body: JSON.stringify({ techId })
    }),
  recruitUnits: (cityId: string, unitId: UnitId, quantity: number) =>
    request<RecruitUnitsResponse>(`/api/cities/${cityId}/units`, {
      method: 'POST',
      body: JSON.stringify({ unitId, quantity })
    }),
  attackPve: (encounterId: string) =>
    request<AttackPveResponse>(`/api/pve/${encounterId}/attack`, {
      method: 'POST'
    })
};

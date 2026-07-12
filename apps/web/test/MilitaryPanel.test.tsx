import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PVE_ENCOUNTERS, type CityView, type MilitaryView } from '@siege/shared';
import { vi } from 'vitest';
import { api } from '../src/api/client.js';
import { MilitaryPanel } from '../src/components/MilitaryPanel.js';

function city(withBarracks = true): CityView {
  return {
    id: 'city-1',
    name: 'Test City',
    buildings: [
      { buildingId: 'townHall', level: 2, workers: 0, workerSlots: 0, plotIndex: 9 },
      { buildingId: 'sawmill', level: 1, workers: 4, workerSlots: 6, plotIndex: 8 },
      { buildingId: 'farm', level: 1, workers: 4, workerSlots: 6, plotIndex: 13 },
      ...(withBarracks
        ? [{ buildingId: 'barracks' as const, level: 1, workers: 0, workerSlots: 0, plotIndex: 18 }]
        : [])
    ],
    resources: {
      amounts: { wood: 500, stone: 400, food: 300, iron: 100, coins: 120, knowledge: 0 },
      ratesPerHour: { wood: 80, stone: 0, food: 48, iron: 0, coins: 32, knowledge: 0 },
      storageCapacity: 1200
    },
    population: {
      total: 20,
      housingCapacity: 50,
      freeCitizens: 12,
      soldiers: 0,
      nextArrivalAt: null
    },
    constructionQueue: [],
    researchedTechs: [],
    serverTime: new Date().toISOString()
  };
}

function military(overrides: Partial<MilitaryView> = {}): MilitaryView {
  return {
    army: { units: { spearman: 0, archer: 0 }, totalUnits: 0, power: 0 },
    encounters: [
      { ...PVE_ENCOUNTERS.banditCamp, completed: false, locked: false },
      { ...PVE_ENCOUNTERS.raiderOutpost, completed: false, locked: true }
    ],
    recentReports: [],
    ...overrides
  };
}

const callbacks = {
  freeCitizens: 12,
  onCityUpdated: vi.fn(),
  onMilitaryUpdated: vi.fn()
};

describe('MilitaryPanel', () => {
  it('prompts for a barracks and keeps encounters visible', () => {
    render(<MilitaryPanel city={city(false)} military={military()} {...callbacks} />);
    expect(screen.getByText(/build a barracks/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Bandit Camp' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Attack with all units' })).toBeDisabled();
  });

  it('shows unit counts, recruitment costs and encounter gates', () => {
    render(<MilitaryPanel city={city()} military={military()} {...callbacks} />);
    expect(screen.getAllByText('In army: 0')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Recruit 1' })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Requires Bandit Camp' })).toBeDisabled();
  });

  it('recruits the selected quantity and publishes both updated views', async () => {
    const user = userEvent.setup();
    const nextCity = city();
    const nextMilitary = military({
      army: { units: { spearman: 3, archer: 0 }, totalUnits: 3, power: 30 }
    });
    const recruitSpy = vi
      .spyOn(api, 'recruitUnits')
      .mockResolvedValueOnce({ city: nextCity, military: nextMilitary });
    const onCityUpdated = vi.fn();
    const onMilitaryUpdated = vi.fn();
    render(
      <MilitaryPanel
        city={city()}
        military={military()}
        freeCitizens={12}
        onCityUpdated={onCityUpdated}
        onMilitaryUpdated={onMilitaryUpdated}
      />
    );

    const input = screen.getByRole('spinbutton', { name: 'Spearman quantity' });
    await user.clear(input);
    await user.type(input, '3');
    await user.click(screen.getByRole('button', { name: 'Recruit 3' }));

    expect(recruitSpy).toHaveBeenCalledWith('city-1', 'spearman', 3);
    expect(onCityUpdated).toHaveBeenCalledWith(nextCity);
    expect(onMilitaryUpdated).toHaveBeenCalledWith(nextMilitary);
  });

  it('renders completed encounters and battle reports', () => {
    render(
      <MilitaryPanel
        city={city()}
        military={military({
          army: { units: { spearman: 4, archer: 0 }, totalUnits: 4, power: 40 },
          encounters: [
            { ...PVE_ENCOUNTERS.banditCamp, completed: true, locked: false },
            { ...PVE_ENCOUNTERS.raiderOutpost, completed: false, locked: false }
          ],
          recentReports: [
            {
              id: 'report-1',
              encounterId: 'banditCamp',
              victory: true,
              attackerPower: 60,
              defenderPower: 60,
              unitsSent: { spearman: 6, archer: 0 },
              unitsLost: { spearman: 2, archer: 0 },
              reward: { wood: 180 },
              foughtAt: new Date().toISOString()
            }
          ]
        })}
        {...callbacks}
      />
    );
    expect(screen.getByRole('button', { name: 'Cleared' })).toBeDisabled();
    expect(screen.getByText(/Bandit Camp: Victory/)).toBeInTheDocument();
    expect(screen.getByText('Lost 2')).toBeInTheDocument();
  });
});

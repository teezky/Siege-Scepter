import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  CITY_PLOTS,
  PVE_ENCOUNTERS,
  type CityView,
  type ConstructionOrderView,
  type MilitaryView
} from '@siege/shared';
import { CityScreen } from '../src/components/CityScreen.js';

function makeCity(overrides: Partial<CityView> = {}): CityView {
  return {
    id: 'city-1',
    name: "tester's Settlement",
    buildings: [
      { buildingId: 'townHall', level: 1, workers: 0, workerSlots: 0, plotIndex: 9 },
      { buildingId: 'sawmill', level: 1, workers: 4, workerSlots: 6, plotIndex: 8 },
      { buildingId: 'farm', level: 1, workers: 4, workerSlots: 6, plotIndex: 13 }
    ],
    resources: {
      amounts: { wood: 500, stone: 400, food: 300, iron: 60, coins: 120, knowledge: 0 },
      // Net rates as the server would report: sawmill 80, farm 72 − 24 upkeep, 4 free × 4 tax.
      ratesPerHour: { wood: 80, stone: 0, food: 48, iron: 0, coins: 16, knowledge: 0 },
      storageCapacity: 1200
    },
    population: {
      total: 12,
      housingCapacity: 30,
      freeCitizens: 4,
      soldiers: 0,
      nextArrivalAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
    },
    constructionQueue: [],
    researchedTechs: [],
    serverTime: new Date().toISOString(),
    ...overrides
  };
}

function makeMilitary(): MilitaryView {
  return {
    army: { units: { spearman: 0, archer: 0 }, totalUnits: 0, power: 0 },
    encounters: [
      { ...PVE_ENCOUNTERS.banditCamp, completed: false, locked: false },
      { ...PVE_ENCOUNTERS.raiderOutpost, completed: false, locked: true }
    ],
    recentReports: []
  };
}

function inProgressOrder(overrides: Partial<ConstructionOrderView> = {}): ConstructionOrderView {
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  return {
    id: 'order-1',
    buildingId: 'quarry',
    targetLevel: 1,
    status: 'IN_PROGRESS',
    queuePosition: 1,
    plotIndex: 12,
    startedAt: new Date().toISOString(),
    completesAt: future,
    ...overrides
  };
}

const noopProps = {
  military: makeMilitary(),
  onCityUpdated: () => undefined,
  onMilitaryUpdated: () => undefined,
  onRefresh: () => Promise.resolve()
};

describe('CityScene plots', () => {
  it('renders every plot; built ones carry their building label', () => {
    render(<CityScreen city={makeCity()} {...noopProps} />);
    const scene = screen.getByRole('region', { name: 'City' });
    const plots = within(scene).getAllByRole('button', { name: /^Plot \d+/ });
    expect(plots).toHaveLength(CITY_PLOTS.length);
    expect(
      within(scene).getByRole('button', { name: 'Plot 8: Sawmill level 1' })
    ).toBeInTheDocument();
    expect(within(scene).getByRole('button', { name: 'Plot 12: empty' })).toBeInTheDocument();
  });

  it('opens a build menu on an empty plot with prereq and cost gating', async () => {
    const user = userEvent.setup();
    render(<CityScreen city={makeCity()} {...noopProps} />);
    await user.click(screen.getByRole('button', { name: 'Plot 12: empty' }));

    const popup = screen.getByRole('dialog', { name: 'Plot 12' });
    expect(within(popup).getByText(/Quarry/)).toBeInTheDocument();
    // Quarry is affordable → plain Build button; iron mine gated by town hall 3.
    const quarryRow = within(popup).getByText(/Quarry/).closest('li')!;
    expect(within(quarryRow).getByRole('button', { name: 'Build' })).toBeEnabled();
    const ironRow = within(popup).getByText(/Iron Mine/).closest('li')!;
    expect(within(ironRow).getByRole('button', { name: 'Requires Town Hall 3' })).toBeDisabled();
    // Already-built buildings are not offered again.
    expect(within(popup).queryByText(/Sawmill/)).not.toBeInTheDocument();
  });

  it('builds on the clicked plot', async () => {
    const user = userEvent.setup();
    const onCityUpdated = vi.fn();
    // The api call will fail (no server in jsdom) — the click wiring is what
    // we assert via fetch interception.
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ city: makeCity() }), { status: 200 }));

    render(<CityScreen city={makeCity()} {...noopProps} onCityUpdated={onCityUpdated} />);
    await user.click(screen.getByRole('button', { name: 'Plot 12: empty' }));
    const popup = screen.getByRole('dialog', { name: 'Plot 12' });
    const quarryRow = within(popup).getByText(/Quarry/).closest('li')!;
    await user.click(within(quarryRow).getByRole('button', { name: 'Build' }));

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/cities/city-1/constructions',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ buildingId: 'quarry', plotIndex: 12 })
      })
    );
    fetchSpy.mockRestore();
  });

  it('shows building details with worker controls and upgrade on a built plot', async () => {
    const user = userEvent.setup();
    render(<CityScreen city={makeCity()} {...noopProps} />);
    await user.click(screen.getByRole('button', { name: 'Plot 8: Sawmill level 1' }));

    const popup = screen.getByRole('dialog', { name: 'Plot 8' });
    expect(popup).toHaveTextContent('Sawmill');
    expect(popup).toHaveTextContent('4/6 workers');
    expect(within(popup).getByRole('button', { name: 'Upgrade to Lv 2' })).toBeEnabled();
    expect(within(popup).getByRole('button', { name: 'Add worker to Sawmill' })).toBeEnabled();
  });

  it('marks reserved plots and keeps queued buildings out of build menus', async () => {
    const user = userEvent.setup();
    const city = makeCity({ constructionQueue: [inProgressOrder()] });
    render(<CityScreen city={city} {...noopProps} />);

    expect(
      screen.getByRole('button', { name: 'Plot 12: Quarry under construction' })
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Plot 7: empty' }));
    const popup = screen.getByRole('dialog', { name: 'Plot 7' });
    expect(within(popup).queryByText(/Quarry/)).not.toBeInTheDocument();
  });

  it('disables upgrades when the queue is full', async () => {
    const user = userEvent.setup();
    const orders = [
      inProgressOrder(),
      inProgressOrder({ id: 'o2', buildingId: 'warehouse', status: 'QUEUED', queuePosition: 2, plotIndex: 4, startedAt: null, completesAt: null }),
      inProgressOrder({ id: 'o3', buildingId: 'sawmill', targetLevel: 2, status: 'QUEUED', queuePosition: 3, plotIndex: null, startedAt: null, completesAt: null }),
      inProgressOrder({ id: 'o4', buildingId: 'farm', targetLevel: 2, status: 'QUEUED', queuePosition: 4, plotIndex: null, startedAt: null, completesAt: null })
    ];
    render(<CityScreen city={makeCity({ constructionQueue: orders })} {...noopProps} />);

    await user.click(screen.getByRole('button', { name: 'Plot 9: Town Hall level 1' }));
    const popup = screen.getByRole('dialog', { name: 'Plot 9' });
    expect(within(popup).getByRole('button', { name: 'Queue full' })).toBeDisabled();
  });

  it('gates iron mine in the build menu behind town hall 3', async () => {
    const user = userEvent.setup();
    render(<CityScreen city={makeCity()} {...noopProps} />);
    await user.click(screen.getByRole('button', { name: 'Plot 0: empty' }));
    const popup = screen.getByRole('dialog', { name: 'Plot 0' });
    const ironRow = within(popup).getByText(/Iron Mine/).closest('li')!;
    expect(within(ironRow).getByRole('button', { name: 'Requires Town Hall 3' })).toBeDisabled();
  });
});

describe('CityScreen resources and queue', () => {
  it('renders the resource bar with amounts and net rates', () => {
    render(<CityScreen city={makeCity()} {...noopProps} />);
    const resourceBar = screen.getByRole('region', { name: 'Resources' });
    expect(resourceBar).toHaveTextContent('Wood');
    expect(resourceBar).toHaveTextContent('500');
    // Rates are derived client-side from workers: 4 sawmill workers × 20/h.
    expect(resourceBar).toHaveTextContent('+80/h');
    // Food is net of upkeep: 72 − 24.
    expect(resourceBar).toHaveTextContent('+48/h');
    expect(resourceBar).toHaveTextContent('1,200');
  });

  it('lists in-progress orders with a countdown and queued ones as queued', () => {
    const orders = [
      inProgressOrder(),
      inProgressOrder({ id: 'o2', buildingId: 'warehouse', status: 'QUEUED', queuePosition: 2, plotIndex: 4, startedAt: null, completesAt: null })
    ];
    render(<CityScreen city={makeCity({ constructionQueue: orders })} {...noopProps} />);
    const queue = screen.getByRole('region', { name: 'Construction queue' });
    expect(queue).toHaveTextContent('Quarry → level 1');
    expect(queue).toHaveTextContent('Warehouse → level 1');
    expect(queue).toHaveTextContent('queued');
  });

  it('shows the idle message when nothing is under construction', () => {
    render(<CityScreen city={makeCity()} {...noopProps} />);
    expect(screen.getByText(/builders are idle/i)).toBeInTheDocument();
  });
});

describe('CityScreen population', () => {
  it('shows population, free citizens and the next arrival', () => {
    render(<CityScreen city={makeCity()} {...noopProps} />);
    const panel = screen.getByRole('region', { name: 'Population' });
    expect(panel).toHaveTextContent('Population (12/30)');
    expect(panel).toHaveTextContent('8 working');
    expect(panel).toHaveTextContent('4 free citizens paying 16 coins/h');
    expect(panel).toHaveTextContent(/next citizen arrives in/i);
  });

  it('warns about a famine when the pantry is empty and drains', () => {
    const city = makeCity({
      buildings: [
        { buildingId: 'townHall', level: 1, workers: 0, workerSlots: 0, plotIndex: 9 },
        { buildingId: 'sawmill', level: 1, workers: 4, workerSlots: 6, plotIndex: 8 },
        { buildingId: 'farm', level: 1, workers: 0, workerSlots: 6, plotIndex: 13 }
      ],
      resources: {
        amounts: { wood: 500, stone: 400, food: 0, iron: 60, coins: 120, knowledge: 0 },
        ratesPerHour: { wood: 80, stone: 0, food: -24, iron: 0, coins: 32, knowledge: 0 },
        storageCapacity: 1200
      }
    });
    render(<CityScreen city={city} {...noopProps} />);
    expect(screen.getByText(/famine/i)).toBeInTheDocument();
  });

  it('crop rotation widens farm slots in the plot popup', async () => {
    const user = userEvent.setup();
    const city = makeCity({
      buildings: [
        { buildingId: 'townHall', level: 1, workers: 0, workerSlots: 0, plotIndex: 9 },
        { buildingId: 'sawmill', level: 1, workers: 4, workerSlots: 6, plotIndex: 8 },
        { buildingId: 'farm', level: 1, workers: 4, workerSlots: 8, plotIndex: 13 }
      ],
      researchedTechs: ['cropRotation']
    });
    render(<CityScreen city={city} {...noopProps} />);
    await user.click(screen.getByRole('button', { name: 'Plot 13: Farm level 1' }));
    expect(screen.getByRole('dialog', { name: 'Plot 13' })).toHaveTextContent('4/8 workers');
  });
});

describe('CityScreen research', () => {
  it('prompts to build an academy when there is none and nothing is researched', () => {
    render(<CityScreen city={makeCity()} {...noopProps} />);
    const panel = screen.getByRole('region', { name: 'Research' });
    expect(panel).toHaveTextContent(/build an academy/i);
    expect(panel).not.toHaveTextContent('Crop Rotation');
  });

  it('lists techs with affordability and prerequisite gating', () => {
    const city = makeCity({
      buildings: [
        { buildingId: 'townHall', level: 2, workers: 0, workerSlots: 0, plotIndex: 9 },
        { buildingId: 'sawmill', level: 1, workers: 4, workerSlots: 6, plotIndex: 8 },
        { buildingId: 'farm', level: 1, workers: 4, workerSlots: 6, plotIndex: 13 },
        { buildingId: 'academy', level: 1, workers: 4, workerSlots: 4, plotIndex: 10 }
      ],
      resources: {
        amounts: { wood: 500, stone: 400, food: 300, iron: 60, coins: 120, knowledge: 150 },
        ratesPerHour: { wood: 80, stone: 0, food: 48, iron: 0, coins: 16, knowledge: 24 },
        storageCapacity: 1200
      }
    });
    render(<CityScreen city={city} {...noopProps} />);
    const panel = screen.getByRole('region', { name: 'Research' });
    expect(panel).toHaveTextContent('Crop Rotation');
    const affordables = screen.getAllByRole('button', { name: 'Research (120 knowledge)' });
    expect(affordables).toHaveLength(2);
    for (const button of affordables) expect(button).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Research (160 knowledge)' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Requires Crop Rotation' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Requires Sanitation' })).toBeDisabled();
  });
});

import { render, screen } from '@testing-library/react';
import { PVE_ENCOUNTERS, type CityView, type ConstructionOrderView, type MilitaryView } from '@siege/shared';
import { CityScreen } from '../src/components/CityScreen.js';

function makeCity(overrides: Partial<CityView> = {}): CityView {
  return {
    id: 'city-1',
    name: "tester's Settlement",
    buildings: [
      { buildingId: 'townHall', level: 1, workers: 0, workerSlots: 0 },
      { buildingId: 'sawmill', level: 1, workers: 4, workerSlots: 6 },
      { buildingId: 'farm', level: 1, workers: 4, workerSlots: 6 }
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

describe('CityScreen building buttons', () => {
  it('shows Build for an unbuilt building with no queued order', () => {
    render(<CityScreen city={makeCity()} {...noopProps} />);
    const quarryCard = screen.getByRole('heading', { name: 'Quarry' }).closest('article')!;
    expect(quarryCard.querySelector(':scope > button')).toHaveTextContent('Build');
  });

  it('shows Upgrade for a built building', () => {
    render(<CityScreen city={makeCity()} {...noopProps} />);
    const sawmillCard = screen.getByRole('heading', { name: 'Sawmill' }).closest('article')!;
    expect(sawmillCard.querySelector(':scope > button')).toHaveTextContent('Upgrade to Lv 2');
  });

  it('uses the queue-promised level, not the built level, for the label', () => {
    // Regression: an unbuilt building with an in-progress level-1 order used to
    // still show "Build" while its cost row already showed the level-2 cost.
    const city = makeCity({ constructionQueue: [inProgressOrder()] });
    render(<CityScreen city={city} {...noopProps} />);
    const quarryCard = screen.getByRole('heading', { name: 'Quarry' }).closest('article')!;
    expect(quarryCard.querySelector(':scope > button')).toHaveTextContent('Upgrade to Lv 2');
  });

  it('gates iron mine behind the town hall prerequisite', () => {
    render(<CityScreen city={makeCity()} {...noopProps} />);
    const ironCard = screen.getByRole('heading', { name: 'Iron Mine' }).closest('article')!;
    const button = ironCard.querySelector(':scope > button')!;
    expect(button).toHaveTextContent('Requires Town Hall 3');
    expect(button).toBeDisabled();
  });

  it('shows Queue full on every button when the queue is at capacity', () => {
    const orders = [
      inProgressOrder(),
      inProgressOrder({ id: 'o2', buildingId: 'warehouse', status: 'QUEUED', queuePosition: 2, startedAt: null, completesAt: null }),
      inProgressOrder({ id: 'o3', buildingId: 'sawmill', targetLevel: 2, status: 'QUEUED', queuePosition: 3, startedAt: null, completesAt: null }),
      inProgressOrder({ id: 'o4', buildingId: 'farm', targetLevel: 2, status: 'QUEUED', queuePosition: 4, startedAt: null, completesAt: null })
    ];
    const city = makeCity({ constructionQueue: orders });
    render(<CityScreen city={city} {...noopProps} />);
    const townHallCard = screen.getByRole('heading', { name: 'Town Hall' }).closest('article')!;
    const button = townHallCard.querySelector(':scope > button')!;
    expect(button).toHaveTextContent('Queue full');
    expect(button).toBeDisabled();
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
      inProgressOrder({ id: 'o2', buildingId: 'warehouse', status: 'QUEUED', queuePosition: 2, startedAt: null, completesAt: null })
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

  it('shows the housing-full message instead of an arrival countdown', () => {
    const city = makeCity({
      population: { total: 30, housingCapacity: 30, freeCitizens: 22, soldiers: 0, nextArrivalAt: null }
    });
    render(<CityScreen city={city} {...noopProps} />);
    const panel = screen.getByRole('region', { name: 'Population' });
    expect(panel).toHaveTextContent(/housing is full/i);
    expect(panel).not.toHaveTextContent(/next citizen arrives/i);
  });

  it('warns about a famine when the pantry is empty and drains', () => {
    const city = makeCity({
      buildings: [
        { buildingId: 'townHall', level: 1, workers: 0, workerSlots: 0 },
        { buildingId: 'sawmill', level: 1, workers: 4, workerSlots: 6 },
        { buildingId: 'farm', level: 1, workers: 0, workerSlots: 6 }
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

  it('renders worker controls and disables + when slots are full', () => {
    const city = makeCity({
      buildings: [
        { buildingId: 'townHall', level: 1, workers: 0, workerSlots: 0 },
        { buildingId: 'sawmill', level: 1, workers: 6, workerSlots: 6 },
        { buildingId: 'farm', level: 1, workers: 4, workerSlots: 6 }
      ]
    });
    render(<CityScreen city={city} {...noopProps} />);
    expect(screen.getByText('6/6 workers')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add worker to Sawmill' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove worker from Sawmill' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Add worker to Farm' })).toBeEnabled();
  });

  it('does not render worker controls for unbuilt or non-production buildings', () => {
    render(<CityScreen city={makeCity()} {...noopProps} />);
    expect(screen.queryByRole('button', { name: /worker.*Quarry/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /worker.*Town Hall/i })).not.toBeInTheDocument();
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
        { buildingId: 'townHall', level: 2, workers: 0, workerSlots: 0 },
        { buildingId: 'sawmill', level: 1, workers: 4, workerSlots: 6 },
        { buildingId: 'farm', level: 1, workers: 4, workerSlots: 6 },
        { buildingId: 'academy', level: 1, workers: 4, workerSlots: 4 }
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
    // 150 knowledge: cropRotation and stoneTools (120 each) are affordable…
    const affordables = screen.getAllByRole('button', { name: 'Research (120 knowledge)' });
    expect(affordables).toHaveLength(2);
    for (const button of affordables) expect(button).toBeEnabled();
    // …sanitation (160) is not, and tier-2 techs are locked by prerequisites.
    expect(screen.getByRole('button', { name: 'Research (160 knowledge)' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Requires Crop Rotation' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Requires Sanitation' })).toBeDisabled();
  });

  it('marks researched techs and shows their effects in the panel', () => {
    const city = makeCity({
      buildings: [
        { buildingId: 'townHall', level: 1, workers: 0, workerSlots: 0 },
        { buildingId: 'sawmill', level: 1, workers: 4, workerSlots: 6 },
        { buildingId: 'farm', level: 1, workers: 4, workerSlots: 8 }
      ],
      researchedTechs: ['cropRotation']
    });
    render(<CityScreen city={city} {...noopProps} />);
    expect(screen.getByText('Researched ✓')).toBeInTheDocument();
    // Crop rotation: farm worker row shows the widened slot count (6+2 at Lv 1).
    expect(screen.getByText('4/8 workers')).toBeInTheDocument();
  });
});

import { render, screen } from '@testing-library/react';
import type { CityView, ConstructionOrderView } from '@siege/shared';
import { CityScreen } from '../src/components/CityScreen.js';

function makeCity(overrides: Partial<CityView> = {}): CityView {
  return {
    id: 'city-1',
    name: "tester's Settlement",
    buildings: [
      { buildingId: 'townHall', level: 1 },
      { buildingId: 'sawmill', level: 1 },
      { buildingId: 'farm', level: 1 }
    ],
    resources: {
      amounts: { wood: 500, stone: 400, food: 300, iron: 60, coins: 120 },
      ratesPerHour: { wood: 120, stone: 0, food: 110, iron: 0, coins: 40 },
      storageCapacity: 1200
    },
    constructionQueue: [],
    serverTime: new Date().toISOString(),
    ...overrides
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
  onCityUpdated: () => undefined,
  onRefresh: () => Promise.resolve()
};

describe('CityScreen building buttons', () => {
  it('shows Build for an unbuilt building with no queued order', () => {
    render(<CityScreen city={makeCity()} {...noopProps} />);
    const quarryCard = screen.getByRole('heading', { name: 'Quarry' }).closest('article')!;
    expect(quarryCard.querySelector('button')).toHaveTextContent('Build');
  });

  it('shows Upgrade for a built building', () => {
    render(<CityScreen city={makeCity()} {...noopProps} />);
    const sawmillCard = screen.getByRole('heading', { name: 'Sawmill' }).closest('article')!;
    expect(sawmillCard.querySelector('button')).toHaveTextContent('Upgrade to Lv 2');
  });

  it('uses the queue-promised level, not the built level, for the label', () => {
    // Regression: an unbuilt building with an in-progress level-1 order used to
    // still show "Build" while its cost row already showed the level-2 cost.
    const city = makeCity({ constructionQueue: [inProgressOrder()] });
    render(<CityScreen city={city} {...noopProps} />);
    const quarryCard = screen.getByRole('heading', { name: 'Quarry' }).closest('article')!;
    expect(quarryCard.querySelector('button')).toHaveTextContent('Upgrade to Lv 2');
  });

  it('gates iron mine behind the town hall prerequisite', () => {
    render(<CityScreen city={makeCity()} {...noopProps} />);
    const ironCard = screen.getByRole('heading', { name: 'Iron Mine' }).closest('article')!;
    const button = ironCard.querySelector('button')!;
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
    const button = townHallCard.querySelector('button')!;
    expect(button).toHaveTextContent('Queue full');
    expect(button).toBeDisabled();
  });
});

describe('CityScreen resources and queue', () => {
  it('renders the resource bar with amounts and rates', () => {
    render(<CityScreen city={makeCity()} {...noopProps} />);
    const resourceBar = screen.getByRole('region', { name: 'Resources' });
    expect(resourceBar).toHaveTextContent('Wood');
    expect(resourceBar).toHaveTextContent('500');
    expect(resourceBar).toHaveTextContent('+120/h');
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

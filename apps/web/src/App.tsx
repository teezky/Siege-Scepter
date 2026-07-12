import { useCallback, useEffect, useState } from 'react';
import type { CityView, MilitaryView, PlayerView } from '@siege/shared';
import { api, ApiRequestError } from './api/client.js';
import { AuthForm } from './components/AuthForm.js';
import { CityScreen } from './components/CityScreen.js';

type Session =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; player: PlayerView };

export function App() {
  const [session, setSession] = useState<Session>({ status: 'loading' });
  const [city, setCity] = useState<CityView | null>(null);
  const [military, setMilitary] = useState<MilitaryView | null>(null);

  const refreshGame = useCallback(async () => {
    const [cityResponse, militaryResponse] = await Promise.all([api.getCity(), api.getMilitary()]);
    setCity(cityResponse.city);
    setMilitary(militaryResponse.military);
  }, []);

  useEffect(() => {
    api
      .me()
      .then(({ player }) => setSession({ status: 'authenticated', player }))
      .catch(() => setSession({ status: 'anonymous' }));
  }, []);

  useEffect(() => {
    if (session.status === 'authenticated') {
      refreshGame().catch(() => {
        setCity(null);
        setMilitary(null);
      });
    }
  }, [session, refreshGame]);

  const handleAuthenticated = (player: PlayerView) => {
    setSession({ status: 'authenticated', player });
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
      // even if the request fails, drop the local session
    }
    setSession({ status: 'anonymous' });
    setCity(null);
    setMilitary(null);
  };

  if (session.status === 'loading') {
    return <div className="page-center">Loading…</div>;
  }

  if (session.status === 'anonymous') {
    return <AuthForm onAuthenticated={handleAuthenticated} />;
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Siege &amp; Scepter</h1>
        <div className="header-right">
          <span className="username">{session.player.username}</span>
          <button className="secondary" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </header>
      {city && military ? (
        <CityScreen
          city={city}
          military={military}
          onCityUpdated={setCity}
          onMilitaryUpdated={setMilitary}
          onRefresh={refreshGame}
        />
      ) : (
        <div className="page-center">Loading your city…</div>
      )}
    </div>
  );
}

export function apiErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.apiError.message;
  return 'Something went wrong. Please try again.';
}

import { useState, type FormEvent } from 'react';
import type { PlayerView } from '@siege/shared';
import { api } from '../api/client.js';
import { apiErrorMessage } from '../App.js';

interface Props {
  onAuthenticated: (player: PlayerView) => void;
}

export function AuthForm({ onAuthenticated }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const { player } =
        mode === 'login'
          ? await api.login({ username, password })
          : await api.register({ username, password });
      onAuthenticated(player);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="page-center">
      <form className="auth-card" onSubmit={submit}>
        <h1>Siege &amp; Scepter</h1>
        <p className="subtitle">
          {mode === 'login' ? 'Welcome back, ruler.' : 'Found your first settlement.'}
        </p>
        <label>
          Username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            minLength={3}
            maxLength={24}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            minLength={8}
            maxLength={128}
            required
          />
        </label>
        {error && <div className="error-box">{error}</div>}
        <button type="submit" disabled={pending}>
          {pending ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
        </button>
        <button
          type="button"
          className="link"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError(null);
          }}
        >
          {mode === 'login' ? 'New here? Create an account' : 'Already have an account? Log in'}
        </button>
      </form>
    </div>
  );
}

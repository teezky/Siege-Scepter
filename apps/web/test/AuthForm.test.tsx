import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthForm } from '../src/components/AuthForm.js';

describe('AuthForm', () => {
  it('starts in login mode', () => {
    render(<AuthForm onAuthenticated={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.getByText('Welcome back, ruler.')).toBeInTheDocument();
  });

  it('toggles to register mode and back', async () => {
    const user = userEvent.setup();
    render(<AuthForm onAuthenticated={() => undefined} />);

    await user.click(screen.getByRole('button', { name: 'New here? Create an account' }));
    expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument();
    expect(screen.getByText('Found your first settlement.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Already have an account? Log in' }));
    expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument();
  });
});

import { zodResolver } from '@hookform/resolvers/zod';
import { loginRequestSchema, registerRequestSchema } from '@gatehouse/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useNavigate } from 'react-router-dom';
import { Field, Mark, Notice } from '../../shared/ui';
import { useRegister, useSession, useSignIn } from './queries';

type Mode = 'signin' | 'setup';

export function LoginPage() {
  const [mode, setMode] = useState<Mode>('signin');
  const session = useSession();

  if (session.data) return <Navigate to="/dashboard" replace />;

  return (
    <main className="auth">
      <div className="auth-inner">
        <div className="auth-mark">
          <Mark size={36} />
        </div>
        {mode === 'signin' ? (
          <SignInForm onSwitch={() => setMode('setup')} />
        ) : (
          <SetupForm onSwitch={() => setMode('signin')} />
        )}
      </div>
    </main>
  );
}

function SignInForm({ onSwitch }: { onSwitch: () => void }) {
  const navigate = useNavigate();
  const signIn = useSignIn();
  const form = useForm({ resolver: zodResolver(loginRequestSchema) });

  return (
    <>
      <h1>Sign in to Gatehouse</h1>
      <p className="auth-sub">Providers, developers, and gateway keys.</p>

      <form
        className="card card-pad"
        onSubmit={form.handleSubmit((values) =>
          signIn.mutate(values, { onSuccess: () => navigate('/dashboard', { replace: true }) }),
        )}
      >
        <Field label="Email" error={form.formState.errors.email?.message}>
          <input type="email" autoComplete="email" autoFocus {...form.register('email')} />
        </Field>
        <Field label="Password" error={form.formState.errors.password?.message}>
          <input type="password" autoComplete="current-password" {...form.register('password')} />
        </Field>

        {signIn.error && (
          <div style={{ marginBottom: 16 }}>
            <Notice kind="error">{signIn.error.message}</Notice>
          </div>
        )}

        <button type="submit" className="primary" style={{ width: '100%' }} disabled={signIn.isPending}>
          {signIn.isPending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="auth-alt">
        First time here?{' '}
        <button type="button" className="link" onClick={onSwitch}>
          Set up the platform
        </button>
      </p>
    </>
  );
}

function SetupForm({ onSwitch }: { onSwitch: () => void }) {
  const navigate = useNavigate();
  const register = useRegister();
  const form = useForm({ resolver: zodResolver(registerRequestSchema) });

  return (
    <>
      <h1>Set up Gatehouse</h1>
      <p className="auth-sub">This creates your organization and its owner. Sign-up closes afterwards.</p>

      <form
        className="card card-pad"
        onSubmit={form.handleSubmit((values) =>
          register.mutate(values, { onSuccess: () => navigate('/dashboard', { replace: true }) }),
        )}
      >
        <Field label="Your name" error={form.formState.errors.name?.message}>
          <input autoComplete="name" autoFocus {...form.register('name')} />
        </Field>
        <Field label="Organization" error={form.formState.errors.organizationName?.message}>
          <input placeholder="Acme" {...form.register('organizationName')} />
        </Field>
        <Field label="Email" error={form.formState.errors.email?.message}>
          <input type="email" autoComplete="email" {...form.register('email')} />
        </Field>
        <Field label="Password" hint="At least 12 characters." error={form.formState.errors.password?.message}>
          <input type="password" autoComplete="new-password" {...form.register('password')} />
        </Field>

        {register.error && (
          <div style={{ marginBottom: 16 }}>
            <Notice kind="error">{register.error.message}</Notice>
          </div>
        )}

        <button type="submit" className="primary" style={{ width: '100%' }} disabled={register.isPending}>
          {register.isPending ? 'Creating…' : 'Create account'}
        </button>
      </form>

      <p className="auth-alt">
        Already set up?{' '}
        <button type="button" className="link" onClick={onSwitch}>
          Back to sign in
        </button>
      </p>
    </>
  );
}

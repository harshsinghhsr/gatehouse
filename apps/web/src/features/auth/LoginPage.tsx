import { zodResolver } from '@hookform/resolvers/zod';
import { loginRequestSchema, registerRequestSchema } from '@gatehouse/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useNavigate } from 'react-router-dom';
import { Field, Notice } from '../../shared/ui';
import { useRegister, useSession, useSignIn } from './queries';

type Mode = 'signin' | 'setup';

export function LoginPage() {
  const [mode, setMode] = useState<Mode>('signin');
  const session = useSession();

  if (session.data) return <Navigate to="/dashboard" replace />;

  return (
    <main className="auth">
      {mode === 'signin' ? <SignInForm onSwitch={() => setMode('setup')} /> : <SetupForm onSwitch={() => setMode('signin')} />}
    </main>
  );
}

function SignInForm({ onSwitch }: { onSwitch: () => void }) {
  const navigate = useNavigate();
  const signIn = useSignIn();
  const form = useForm({ resolver: zodResolver(loginRequestSchema) });

  return (
    <form
      className="card"
      onSubmit={form.handleSubmit((values) =>
        signIn.mutate(values, { onSuccess: () => navigate('/dashboard', { replace: true }) }),
      )}
    >
      <h1>Sign in</h1>
      <p className="muted" style={{ marginTop: 0, marginBottom: 20, fontSize: 13 }}>
        Manage providers, developers, and gateway keys.
      </p>

      <Field label="Email" error={form.formState.errors.email?.message}>
        <input type="email" autoComplete="email" autoFocus {...form.register('email')} />
      </Field>
      <Field label="Password" error={form.formState.errors.password?.message}>
        <input type="password" autoComplete="current-password" {...form.register('password')} />
      </Field>

      {signIn.error && (
        <div style={{ margin: '4px 0 14px' }}>
          <Notice kind="error">{signIn.error.message}</Notice>
        </div>
      )}

      <button type="submit" className="primary" style={{ width: '100%' }} disabled={signIn.isPending}>
        {signIn.isPending ? 'Signing in…' : 'Sign in'}
      </button>
      <button type="button" onClick={onSwitch} style={switchStyle}>
        First time here? Set up the platform
      </button>
    </form>
  );
}

function SetupForm({ onSwitch }: { onSwitch: () => void }) {
  const navigate = useNavigate();
  const register = useRegister();
  const form = useForm({ resolver: zodResolver(registerRequestSchema) });

  return (
    <form
      className="card"
      onSubmit={form.handleSubmit((values) =>
        register.mutate(values, { onSuccess: () => navigate('/dashboard', { replace: true }) }),
      )}
    >
      <h1>Set up the platform</h1>
      <p className="muted" style={{ marginTop: 0, marginBottom: 20, fontSize: 13 }}>
        This creates your organization and its owner. After that, admins invite everyone else.
      </p>

      <Field label="Your name" error={form.formState.errors.name?.message}>
        <input autoComplete="name" autoFocus {...form.register('name')} />
      </Field>
      <Field label="Organization" error={form.formState.errors.organizationName?.message}>
        <input placeholder="Acme" {...form.register('organizationName')} />
      </Field>
      <Field label="Email" error={form.formState.errors.email?.message}>
        <input type="email" autoComplete="email" {...form.register('email')} />
      </Field>
      <Field
        label="Password"
        hint="At least 12 characters."
        error={form.formState.errors.password?.message}
      >
        <input type="password" autoComplete="new-password" {...form.register('password')} />
      </Field>

      {register.error && (
        <div style={{ margin: '4px 0 14px' }}>
          <Notice kind="error">{register.error.message}</Notice>
        </div>
      )}

      <button type="submit" className="primary" style={{ width: '100%' }} disabled={register.isPending}>
        {register.isPending ? 'Creating…' : 'Create account'}
      </button>
      <button type="button" onClick={onSwitch} style={switchStyle}>
        Back to sign in
      </button>
    </form>
  );
}

const switchStyle = { width: '100%', marginTop: 8, border: 'none', color: 'var(--ink-soft)' } as const;

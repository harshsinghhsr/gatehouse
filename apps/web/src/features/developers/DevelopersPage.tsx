import { zodResolver } from '@hookform/resolvers/zod';
import { createDeveloperRequestSchema } from '@gatehouse/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { Badge, Empty, Field, FormCard, Notice, PageHead, QueryState, Status, Table } from '../../shared/ui';
import { useCreateDeveloper, useDevelopers } from './queries';

export function DevelopersPage() {
  const developers = useDevelopers();
  const [adding, setAdding] = useState(false);

  return (
    <div className="stack">
      <PageHead
        title="Developers"
        description="Everyone who can hold a gateway key. Grant models and a budget on a developer, then issue the key."
        action={
          <button type="button" className={adding ? '' : 'primary'} onClick={() => setAdding((open) => !open)}>
            {adding ? 'Cancel' : 'Add developer'}
          </button>
        }
      />

      {adding && <AddDeveloperForm onDone={() => setAdding(false)} />}

      <QueryState isPending={developers.isPending} error={developers.error}>
        <Table head={['Developer', 'Role', 'Status', '>Active keys']}>
          {developers.data?.length === 0 && (
            <Empty
              title="No developers yet"
              action={
                <button type="button" className="btn btn-primary small" onClick={() => setAdding(true)}>
                  Add developer
                </button>
              }
            >
              A developer is anyone who should hold a key to the gateway.
            </Empty>
          )}
          {developers.data?.map((developer) => (
            <tr key={developer.id}>
              <td>
                <Link to={`/developers/${developer.id}`}>{developer.name}</Link>
                <div className="mono muted">{developer.email}</div>
              </td>
              <td>
                <Badge tone={developer.role === 'MEMBER' ? 'neutral' : 'info'}>{developer.role.toLowerCase()}</Badge>
              </td>
              <td>
                <Status state={developer.status === 'ACTIVE' ? 'ok' : 'idle'}>
                  {developer.status === 'ACTIVE' ? 'Active' : 'Disabled'}
                </Status>
              </td>
              <td className="num">{developer.activeKeys}</td>
            </tr>
          ))}
        </Table>
      </QueryState>
    </div>
  );
}

function AddDeveloperForm({ onDone }: { onDone: () => void }) {
  const createDeveloper = useCreateDeveloper();
  const form = useForm({
    resolver: zodResolver(createDeveloperRequestSchema),
    defaultValues: { role: 'MEMBER' as const },
  });

  return (
    <FormCard
      hint="They can hold keys straight away."
      action={
        <button type="submit" className="primary" disabled={createDeveloper.isPending}>
          Add developer
        </button>
      }
      onSubmit={form.handleSubmit((values) =>
        createDeveloper.mutate(
          { ...values, password: values.password || undefined },
          {
            onSuccess: () => {
              form.reset();
              onDone();
            },
          },
        ),
      )}
    >
      <Field label="Name" error={form.formState.errors.name?.message}>
        <input {...form.register('name')} />
      </Field>
      <Field label="Email" error={form.formState.errors.email?.message}>
        <input type="email" {...form.register('email')} />
      </Field>
      <Field
        label="Password"
        hint="Optional. Set one only if this person signs into the dashboard."
        error={form.formState.errors.password?.message}
      >
        <input type="password" autoComplete="new-password" {...form.register('password')} />
      </Field>
      <Field label="Role">
        <select {...form.register('role')}>
          <option value="MEMBER">Member — uses the gateway</option>
          <option value="ADMIN">Admin — manages providers and keys</option>
        </select>
      </Field>

      {createDeveloper.error && (
        <div style={{ marginBottom: 16 }}>
          <Notice kind="error">{createDeveloper.error.message}</Notice>
        </div>
      )}
    </FormCard>
  );
}

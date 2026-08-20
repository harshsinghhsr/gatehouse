import type { ProviderType } from '@gatehouse/shared';
import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Field, Notice, PageHead, QueryState } from '../../shared/ui';
import { useCreateProvider, useProviderTypes } from './queries';

/**
 * The form is driven by the catalog the API publishes, so a new provider type appears here
 * without a change to this file.
 */
export function NewProviderPage() {
  const navigate = useNavigate();
  const types = useProviderTypes();
  const createProvider = useCreateProvider();
  const [selected, setSelected] = useState<ProviderType | null>(null);

  const chosen = types.data?.find((type) => type.type === selected) ?? types.data?.[0];

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!chosen) return;

    const form = new FormData(event.currentTarget);
    const collect = (fields: ReadonlyArray<{ name: string }>) =>
      Object.fromEntries(
        fields.flatMap((field) => {
          const value = String(form.get(field.name) ?? '').trim();
          return value ? [[field.name, value]] : [];
        }),
      );

    createProvider.mutate(
      {
        name: String(form.get('name')),
        type: chosen.type,
        credentials: collect(chosen.credentialFields),
        config: collect(chosen.configFields),
      },
      { onSuccess: () => navigate('/providers') },
    );
  }

  return (
    <div className="stack">
      <PageHead
        title="Add provider"
        description="The credential is checked against the provider before anything is stored. That check runs on the server — the browser never contacts the provider."
      />

      <QueryState isPending={types.isPending} error={types.error}>
        <form className="card card-pad" style={{ maxWidth: 560 }} onSubmit={submit}>
          <Field label="Provider">
            <select
              value={chosen?.type ?? ''}
              onChange={(event) => setSelected(event.target.value as ProviderType)}
            >
              {types.data?.map((type) => (
                <option key={type.type} value={type.type}>
                  {type.displayName}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Name" hint="How this connection appears in the dashboard, e.g. “Azure Prod EU”.">
            <input name="name" required maxLength={80} />
          </Field>

          {chosen?.credentialFields.map((field) => (
            <Field key={field.name} label={field.label} hint="Stored in the secret store. Never displayed again.">
              <input name={field.name} type="password" required autoComplete="off" />
            </Field>
          ))}

          {chosen?.configFields.map((field) => (
            <Field key={field.name} label={field.required ? field.label : `${field.label} (optional)`}>
              <input name={field.name} required={field.required} placeholder={field.placeholder ?? ''} />
            </Field>
          ))}

          {createProvider.error && (
            <div style={{ margin: '4px 0 14px' }}>
              <Notice kind="error">{createProvider.error.message}</Notice>
            </div>
          )}

          <div className="row">
            <button type="submit" className="primary" disabled={createProvider.isPending}>
              {createProvider.isPending ? 'Checking credential…' : 'Add provider'}
            </button>
            <button type="button" onClick={() => navigate(-1)}>
              Cancel
            </button>
          </div>
        </form>
      </QueryState>
    </div>
  );
}

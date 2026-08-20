import type { ReactNode } from 'react';
import { useSession } from '../auth/queries';
import { Dot, PageHead } from '../../shared/ui';
import { useConnectInfo, useHealth } from '../usage/queries';

export function SettingsPage() {
  const session = useSession();
  const health = useHealth();
  const connect = useConnectInfo();

  const organization = session.data?.organizations.find(
    (org) => org.id === session.data.activeOrganizationId,
  );

  return (
    <div className="stack">
      <PageHead
        title="Settings"
        description="Organization, account, and the health of the services behind the gateway."
      />

      <div className="grid grid-half">
        <section>
          <h2>Organization</h2>
          <div className="card card-pad">
            <Row label="Name">{organization?.name ?? '—'}</Row>
            <Row label="Slug" mono>
              {organization?.slug ?? '—'}
            </Row>
            <Row label="Your role">{session.data?.role.toLowerCase() ?? '—'}</Row>
            <div className="hint">
              The slug namespaces this organization&rsquo;s models inside the gateway, so two organizations
              can both publish a model called gpt-5.
            </div>
          </div>
        </section>

        <section>
          <h2>Account</h2>
          <div className="card card-pad">
            <Row label="Name">{session.data?.user.name ?? '—'}</Row>
            <Row label="Email" mono>
              {session.data?.user.email ?? '—'}
            </Row>
          </div>
        </section>

        <section>
          <h2>Services</h2>
          <div className="card card-pad">
            {Object.entries(health.data?.services ?? {}).map(([name, state]) => (
              <div key={name} className="row" style={{ justifyContent: 'space-between', padding: '4px 0' }}>
                <span>
                  <Dot state={state === 'ok' ? 'ok' : 'down'} />
                  {name}
                </span>
                <span className="mono muted">{state}</span>
              </div>
            ))}
            {!health.data && <span className="muted">Health unavailable.</span>}
          </div>
        </section>

        <section>
          <h2>Gateway endpoint</h2>
          <div className="card card-pad">
            <pre>{connect.data?.openai.baseUrl ?? '—'}</pre>
            <div className="hint">
              This is the URL developers put in their SDK. Administrative routes are not exposed there.
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function Row({ label, mono, children }: { label: string; mono?: boolean; children: ReactNode }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', padding: '5px 0' }}>
      <span className="muted">{label}</span>
      <span className={mono ? 'mono' : undefined}>{children}</span>
    </div>
  );
}

import type { ReactNode } from 'react';
import { useSession } from '../auth/queries';
import { Badge, Code, PageHead, Section, Status } from '../../shared/ui';
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
        <Section title="Organization">
          <div className="card">
            <div className="card-pad" style={{ paddingBottom: 8 }}>
              <Row label="Name">{organization?.name ?? '—'}</Row>
              <Row label="Slug" mono>
                {organization?.slug ?? '—'}
              </Row>
              <Row label="Your role">
                <Badge tone="info">{session.data?.role.toLowerCase() ?? '—'}</Badge>
              </Row>
            </div>
            <div className="card-foot">
              The slug namespaces this organization&rsquo;s models inside the gateway, so two organizations can
              both publish a model called gpt-5.
            </div>
          </div>
        </Section>

        <Section title="Account">
          <div className="card card-pad">
            <Row label="Name">{session.data?.user.name ?? '—'}</Row>
            <Row label="Email" mono>
              {session.data?.user.email ?? '—'}
            </Row>
            <Row label="Theme">
              <span className="muted">Set from the toolbar</span>
            </Row>
          </div>
        </Section>

        <Section title="Services">
          <div className="card">
            {Object.entries(health.data?.services ?? {}).map(([name, state], index) => (
              <div
                key={name}
                className="row"
                style={{
                  justifyContent: 'space-between',
                  padding: '12px 20px',
                  borderTop: index === 0 ? 'none' : '1px solid var(--gray-200)',
                }}
              >
                <Status state={state === 'ok' ? 'ok' : 'down'}>{name}</Status>
                <Badge tone={state === 'ok' ? 'ok' : 'error'}>{state}</Badge>
              </div>
            ))}
            {!health.data && <div className="card-pad muted">Health unavailable.</div>}
          </div>
        </Section>

        <Section title="Gateway endpoint" description="What developers put in their SDK.">
          <Code>{connect.data?.openai.baseUrl ?? '—'}</Code>
        </Section>
      </div>
    </div>
  );
}

function Row({ label, mono, children }: { label: string; mono?: boolean; children: ReactNode }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', padding: '7px 0' }}>
      <span className="muted">{label}</span>
      <span className={mono ? 'mono' : undefined}>{children}</span>
    </div>
  );
}

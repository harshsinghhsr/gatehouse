import { type FormEvent, useState } from 'react';
import { Badge, Empty, FormCard, PageHead, QueryState, Section, Table } from '../../shared/ui';
import { useSession } from '../auth/queries';
import { useDevelopers } from '../developers/queries';
import { useModels } from '../models/queries';
import {
  useAddTeamMember,
  useCreateTeam,
  useDeleteTeam,
  useRemoveTeamMember,
  useSetTeamModels,
  useTeam,
  useTeams,
} from './queries';

export function TeamsPage() {
  const teams = useTeams();
  const createTeam = useCreateTeam();
  const deleteTeam = useDeleteTeam();
  const [openTeamId, setOpenTeamId] = useState<string | null>(null);

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    createTeam.mutate({ name: String(new FormData(form).get('name')) }, { onSuccess: () => form.reset() });
  }

  return (
    <div className="stack">
      <PageHead
        title="Teams"
        description="Grant models to a group instead of one developer at a time. A member's key carries their own grants plus every team they belong to."
      />

      <QueryState isPending={teams.isPending} error={teams.error}>
        <Table head={['Team', 'Slug', '>Members', '']}>
          {teams.data?.length === 0 && (
            <Empty title="No teams yet">Create one below, then add members and grant models once.</Empty>
          )}
          {teams.data?.map((team) => (
            <tr key={team.id}>
              <td>
                <button type="button" className="link" onClick={() => setOpenTeamId(team.id)}>
                  {team.name}
                </button>
              </td>
              <td className="mono muted">{team.slug}</td>
              <td className="num">{team.memberCount}</td>
              <td className="num">
                <div className="row" style={{ justifyContent: 'flex-end' }}>
                  <button type="button" className="small" onClick={() => setOpenTeamId(team.id)}>
                    Manage
                  </button>
                  <button
                    type="button"
                    className="small danger"
                    onClick={() => {
                      if (confirm(`Delete ${team.name}? Members keep their own grants.`)) {
                        deleteTeam.mutate(team.id, {
                          onSuccess: () => setOpenTeamId((current) => (current === team.id ? null : current)),
                        });
                      }
                    }}
                  >
                    Delete
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </Table>
      </QueryState>

      {openTeamId && <TeamEditor teamId={openTeamId} />}

      <Section title="New team">
        <form className="card card-pad row" style={{ maxWidth: 480 }} onSubmit={create}>
          <input name="name" required maxLength={80} placeholder="Platform" style={{ flex: 1, width: 'auto' }} />
          <button type="submit" className="primary" disabled={createTeam.isPending}>
            Create team
          </button>
        </form>
      </Section>
    </div>
  );
}

function TeamEditor({ teamId }: { teamId: string }) {
  const team = useTeam(teamId);
  const developers = useDevelopers();
  const models = useModels();

  const session = useSession();
  // Matches the server rule: only an instance admin may appoint or remove a lead.
  const mayAppointLead = session.data?.role === 'OWNER' || session.data?.role === 'ADMIN';

  const addMember = useAddTeamMember(teamId);
  const removeMember = useRemoveTeamMember(teamId);
  const setTeamModels = useSetTeamModels(teamId);

  return (
    <QueryState isPending={team.isPending} error={team.error}>
      {team.data && (
        <div className="grid grid-half">
          <Section title={`${team.data.name} · members`}>
            <div className="card">
              {team.data.members.length === 0 && <div className="card-pad muted">No members yet.</div>}
              {team.data.members.map((member, index) => (
                <div
                  key={member.id}
                  className="row"
                  style={{
                    justifyContent: 'space-between',
                    padding: '10px 20px',
                    borderTop: index === 0 ? 'none' : '1px solid var(--gray-200)',
                  }}
                >
                  <span className="row">
                    {member.name} <span className="mono muted">{member.email}</span>
                    <Badge tone={member.role === 'LEAD' ? 'info' : 'neutral'}>{member.role}</Badge>
                  </span>
                  <div className="row">
                    {mayAppointLead && (
                      <button
                        type="button"
                        className="small"
                        onClick={() =>
                          addMember.mutate({
                            userId: member.id,
                            role: member.role === 'LEAD' ? 'MEMBER' : 'LEAD',
                          })
                        }
                      >
                        {member.role === 'LEAD' ? 'Remove lead' : 'Make lead'}
                      </button>
                    )}
                    <button type="button" className="small danger" onClick={() => removeMember.mutate(member.id)}>
                      Remove
                    </button>
                  </div>
                </div>
              ))}

              <form
                className="card-foot"
                onSubmit={(event) => {
                  event.preventDefault();
                  addMember.mutate({
                    userId: String(new FormData(event.currentTarget).get('userId')),
                    role: 'MEMBER',
                  });
                }}
              >
                <select name="userId" aria-label="Add member" style={{ flex: 1 }}>
                  {developers.data?.map((developer) => (
                    <option key={developer.id} value={developer.id}>
                      {developer.name} — {developer.email}
                    </option>
                  ))}
                </select>
                <button type="submit" disabled={addMember.isPending}>
                  Add
                </button>
              </form>
            </div>
          </Section>

          <Section title={`${team.data.name} · models`}>
            <FormCard
              maxWidth={9999}
              hint="Applies to every member's live keys."
              action={
                <button type="submit" className="primary" disabled={setTeamModels.isPending}>
                  Save access
                </button>
              }
              onSubmit={(event) => {
                event.preventDefault();
                const modelIds = new FormData(event.currentTarget).getAll('model').map(String);
                setTeamModels.mutate({ modelIds });
              }}
            >
              {models.data?.length === 0 && <p className="muted">No models exist yet.</p>}
              {models.data?.map((model) => (
                <label key={model.id} className="choice">
                  <input
                    type="checkbox"
                    name="model"
                    value={model.id}
                    defaultChecked={team.data.models.some((granted) => granted.id === model.id)}
                  />
                  <span className="mono">{model.publicModelName}</span>
                </label>
              ))}
            </FormCard>
          </Section>
        </div>
      )}
    </QueryState>
  );
}

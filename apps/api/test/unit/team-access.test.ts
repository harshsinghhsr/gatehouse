import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuditService } from '../../src/modules/audit/audit.service.js';
import type { AuthContext } from '../../src/modules/auth/authenticator.js';
import type { AccessService } from '../../src/modules/developers/access.service.js';
import type { TeamRepository } from '../../src/modules/teams/team.repository.js';
import { TeamService } from '../../src/modules/teams/team.service.js';
import type { UserService } from '../../src/modules/users/user.service.js';
import { autoStub, fakeGateway, fakeUnitOfWork, stubRepositories } from '../support/fakes.js';

/**
 * The team-lead boundary. A lead runs their own team and nothing else, so every assertion here
 * is about what a lead may NOT reach.
 */

const lead: AuthContext = { userId: 'user-lead', role: 'MEMBER', ip: null };
const admin: AuthContext = { userId: 'user-admin', role: 'ADMIN', ip: null };

/** Team A is led by user-lead. Team B has no leads. */
function serviceWith(overrides: Partial<TeamRepository> = {}) {
  const teams = autoStub<TeamRepository>('teams', {
    findById: async (id: string) =>
      id === 'team-a' || id === 'team-b'
        ? { id, name: id, slug: id, litellmTeamId: null }
        : null,
    findMember: async (teamId: string, userId: string) =>
      teamId === 'team-a' && userId === 'user-lead' ? { userId, role: 'LEAD' as const } : null,
    ...overrides,
  });
  const repos = stubRepositories({ teams });
  return new TeamService(
    fakeUnitOfWork(repos),
    fakeGateway(),
    autoStub<UserService>('users', {}),
    // The happy-path test runs past the guards into these two; the refusal tests never reach
    // them, and autoStub throws on anything else either way.
    autoStub<AccessService>('access', {
      requireUser: async (id: string) => ({
        id,
        email: `${id}@example.com`,
        name: id,
        role: 'MEMBER' as const,
        status: 'ACTIVE' as const,
      }),
      syncActiveKeys: async () => {},
    }),
    autoStub<AuditService>('audit', { record: async () => {} }),
  );
}

test('a lead is refused on a team they do not lead', async () => {
  await assert.rejects(
    () => serviceWith().addMember(lead, 'team-b', 'user-x'),
    /do not lead this team/i,
  );
});

test('a lead is refused on another team’s model access', async () => {
  await assert.rejects(
    () => serviceWith().setModelAccess(lead, 'team-b', ['model-1']),
    /do not lead this team/i,
  );
});

test('a lead cannot appoint another lead', async () => {
  await assert.rejects(
    () => serviceWith().addMember(lead, 'team-a', 'user-x', 'LEAD'),
    /only an admin can appoint a team lead/i,
  );
});

test('a lead cannot remove an existing lead', async () => {
  const service = serviceWith({
    findMember: async (teamId: string, userId: string) =>
      teamId === 'team-a' && (userId === 'user-lead' || userId === 'user-other')
        ? { userId, role: 'LEAD' as const }
        : null,
  });
  await assert.rejects(
    () => service.removeMember(lead, 'team-a', 'user-other'),
    /only an admin can remove a team lead/i,
  );
});

test('an admin may appoint a lead on any team', async () => {
  const added: unknown[] = [];
  const service = serviceWith({
    addMember: async (...args: unknown[]) => {
      added.push(args);
    },
  });
  await service.addMember(admin, 'team-b', 'user-x', 'LEAD');
  assert.deepEqual(added, [['team-b', 'user-x', 'LEAD']]);
});

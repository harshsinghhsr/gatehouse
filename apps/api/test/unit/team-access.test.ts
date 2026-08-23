import assert from 'node:assert/strict';
import test from 'node:test';
import { ForbiddenError } from '../../src/core/errors.js';
import type { Db } from '../../src/infra/db/client.js';
import type { AuditService } from '../../src/modules/audit/audit.service.js';
import type { AuthContext } from '../../src/modules/auth/authenticator.js';
import type { AccessService } from '../../src/modules/developers/access.service.js';
import { PrismaTeamRepository, type TeamRepository } from '../../src/modules/teams/team.repository.js';
import { TeamService } from '../../src/modules/teams/team.service.js';
import type { UserService } from '../../src/modules/users/user.service.js';
import { autoStub, fakeGateway, fakeUnitOfWork, stubRepositories } from '../support/fakes.js';

/**
 * The team-lead boundary. A lead runs their own team and nothing else, so every assertion here
 * is about what a lead may NOT reach.
 */

const lead: AuthContext = { userId: 'user-lead', role: 'MEMBER', ip: null };
const plain: AuthContext = { userId: 'user-plain', role: 'MEMBER', ip: null };
const admin: AuthContext = { userId: 'user-admin', role: 'ADMIN', ip: null };

/**
 * Both halves matter: refusals must be the domain `ForbiddenError` (a plain Error with the same
 * wording would leave `http/error-handler.ts` mapping it to a 500), and the message identifies
 * *which* rule refused, so one guard cannot masquerade as another.
 */
const forbidden = (message: RegExp) => (error: unknown) => {
  assert.ok(error instanceof ForbiddenError, `expected ForbiddenError, got ${String(error)}`);
  assert.match(error.message, message);
  return true;
};

/** Team A is led by user-lead and has user-plain as a rank-and-file member. Team B has no leads. */
function serviceWith(overrides: Partial<TeamRepository> = {}) {
  const teams = autoStub<TeamRepository>('teams', {
    findById: async (id: string) =>
      id === 'team-a' || id === 'team-b'
        ? { id, name: id, slug: id, litellmTeamId: null }
        : null,
    findMember: async (teamId: string, userId: string) => {
      if (teamId !== 'team-a') return null;
      if (userId === 'user-lead') return { userId, role: 'LEAD' as const };
      if (userId === 'user-plain') return { userId, role: 'MEMBER' as const };
      return null;
    },
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
    forbidden(/do not lead this team/i),
  );
});

test('a lead is refused on another team’s model access', async () => {
  await assert.rejects(
    () => serviceWith().setModelAccess(lead, 'team-b', ['model-1']),
    forbidden(/do not lead this team/i),
  );
});

test('a lead cannot appoint another lead', async () => {
  await assert.rejects(
    () => serviceWith().addMember(lead, 'team-a', 'user-x', 'LEAD'),
    forbidden(/only an admin can appoint a team lead/i),
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
    forbidden(/only an admin can remove a team lead/i),
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

/** A team with two leads: user-lead (the caller) and user-other (the peer). */
function serviceWithPeerLead(added: unknown[]) {
  return serviceWith({
    findMember: async (teamId: string, userId: string) =>
      teamId === 'team-a' && (userId === 'user-lead' || userId === 'user-other')
        ? { userId, role: 'LEAD' as const }
        : null,
    addMember: async (...args: unknown[]) => {
      added.push(args);
    },
    removeMember: async (...args: unknown[]) => {
      added.push(args);
    },
  });
}

test('a lead cannot demote a peer lead by re-adding them as a member', async () => {
  // The upsert overwrites the stored role, so without a guard this demotes the peer and the
  // "only an admin can remove a team lead" rule falls in two calls.
  const added: unknown[] = [];
  await assert.rejects(
    () => serviceWithPeerLead(added).addMember(lead, 'team-a', 'user-other', 'MEMBER'),
    forbidden(/only an admin can change a team lead/i),
  );
  assert.deepEqual(added, [], 'the refusal must happen before any write');
});

test('an admin may still demote a lead', async () => {
  const added: unknown[] = [];
  await serviceWithPeerLead(added).addMember(admin, 'team-a', 'user-other', 'MEMBER');
  assert.deepEqual(added, [['team-a', 'user-other', 'MEMBER']]);
});

test('a plain team member is refused on every managed path', async () => {
  const added: unknown[] = [];
  const service = serviceWith({
    addMember: async (...args: unknown[]) => {
      added.push(args);
    },
    removeMember: async (...args: unknown[]) => {
      added.push(args);
    },
  });
  // Belonging to a team is not leading it: the guard must reject role MEMBER, not merely null.
  await assert.rejects(
    () => service.addMember(plain, 'team-a', 'user-x'),
    forbidden(/do not lead this team/i),
  );
  await assert.rejects(
    () => service.removeMember(plain, 'team-a', 'user-lead'),
    forbidden(/do not lead this team/i),
  );
  await assert.rejects(
    () => service.setModelAccess(plain, 'team-a', ['model-1']),
    forbidden(/do not lead this team/i),
  );
  assert.deepEqual(added, []);
});

test('a lead may add an ordinary member to their own team', async () => {
  const added: unknown[] = [];
  const service = serviceWith({
    addMember: async (...args: unknown[]) => {
      added.push(args);
    },
  });
  await service.addMember(lead, 'team-a', 'user-x');
  assert.deepEqual(added, [['team-a', 'user-x', 'MEMBER']]);
});

/** The picker feed: same authority as the mutations it precedes, and a much narrower payload. */
const candidates = [{ id: 'user-x', name: 'X', email: 'x@example.com' }];

function serviceWithCandidates() {
  return serviceWith({ listCandidates: async () => candidates });
}

test('a lead may list candidates for their own team', async () => {
  assert.deepEqual(await serviceWithCandidates().listCandidates(lead, 'team-a'), candidates);
});

test('an admin may list candidates for any team', async () => {
  assert.deepEqual(await serviceWithCandidates().listCandidates(admin, 'team-b'), candidates);
});

test('a plain team member cannot list candidates', async () => {
  await assert.rejects(
    () => serviceWithCandidates().listCandidates(plain, 'team-a'),
    forbidden(/do not lead this team/i),
  );
});

test('a lead cannot list candidates for a team they do not lead', async () => {
  await assert.rejects(
    () => serviceWithCandidates().listCandidates(lead, 'team-b'),
    forbidden(/do not lead this team/i),
  );
});

test('the candidate query excludes existing members and non-ACTIVE users', async () => {
  // Filtering belongs in the query, not in the service: proving the where clause is the only
  // way to show the roster is never fetched and trimmed in memory.
  let where: unknown;
  const repository = new PrismaTeamRepository({
    user: {
      findMany: async (args: { where: unknown }) => {
        where = args.where;
        return [];
      },
    },
  } as unknown as Db);

  assert.deepEqual(await repository.listCandidates('team-a'), []);
  assert.deepEqual(where, { status: 'ACTIVE', teamMembers: { none: { teamId: 'team-a' } } });
});

/**
 * `viewerRole` on the team list. It is what the dashboard uses to decide whether the viewer may
 * manage a given team, so a non-member must read as null rather than as an absent field.
 */
const listRows = [
  { id: 'team-a', name: 'A', slug: 'a', litellmTeamId: null, memberCount: 2, viewerRole: 'LEAD' as const },
  { id: 'team-b', name: 'B', slug: 'b', litellmTeamId: null, memberCount: 0, viewerRole: null },
];

test('the team list reports the caller’s own role in each team', async () => {
  let askedFor: string | undefined;
  const service = serviceWith({
    list: async (viewerId: string) => {
      askedFor = viewerId;
      return listRows;
    },
  });

  assert.deepEqual(await service.list(lead), [
    { id: 'team-a', name: 'A', slug: 'a', memberCount: 2, viewerRole: 'LEAD' },
    { id: 'team-b', name: 'B', slug: 'b', memberCount: 0, viewerRole: null },
  ]);
  // The viewer comes from the session, never from the request.
  assert.equal(askedFor, 'user-lead');
});

test('an admin who belongs to no team still sees viewerRole null', async () => {
  // Instance authority is not team membership: the row states the membership fact, and the
  // client combines it with the instance role. Conflating them here would lie about the team.
  const service = serviceWith({ list: async () => listRows.map((row) => ({ ...row, viewerRole: null })) });
  assert.deepEqual(
    (await service.list(admin)).map((team) => team.viewerRole),
    [null, null],
  );
});

test('a fresh team the caller created is not a team they belong to', async () => {
  const service = serviceWith({
    create: async () => ({ id: 'team-new', name: 'New', slug: 'new', litellmTeamId: 'gw-1' }),
  });
  assert.deepEqual(await service.create(admin, { name: 'New' }), {
    id: 'team-new',
    name: 'New',
    slug: 'new',
    memberCount: 0,
    viewerRole: null,
  });
});

test('the list query reads the viewer’s membership in one round-trip', async () => {
  // N+1 here would mean a membership query per team; proving the select carries the filtered
  // members relation is the only way to show it is a single findMany.
  let args: { select?: Record<string, unknown> } = {};
  const repository = new PrismaTeamRepository({
    team: {
      findMany: async (received: { select?: Record<string, unknown> }) => {
        args = received;
        return [{ id: 't', name: 'T', slug: 't', litellmTeamId: null, _count: { members: 3 }, members: [] }];
      },
    },
  } as unknown as Db);

  assert.deepEqual(await repository.list('user-plain'), [
    { id: 't', name: 'T', slug: 't', litellmTeamId: null, memberCount: 3, viewerRole: null },
  ]);
  assert.deepEqual(args.select?.members, { where: { userId: 'user-plain' }, select: { role: true } });
});

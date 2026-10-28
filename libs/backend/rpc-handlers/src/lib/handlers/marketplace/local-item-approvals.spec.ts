/**
 * LocalItemApprovals (TASK_2026_701 B12, A21): bounded, expiring, family- and
 * root-bound approval records; only the id leaves the server.
 */
import 'reflect-metadata';
import {
  KEPT_ITEM_APPROVAL_TTL_MS,
  LocalItemApprovals,
  MAX_LOCAL_ITEM_APPROVALS,
  type LocalItemApprovalInput,
} from './local-item-approvals';

const ROOT = '/workspace/acme-app';

function item(overrides: Partial<LocalItemApprovalInput> = {}): LocalItemApprovalInput {
  return {
    harnessRoot: ROOT,
    family: 'external',
    kind: 'owned-edited',
    target: 'claude',
    relPath: '.claude/skills/api-design',
    sourceRef: 'external:acme/toolkit/toolkit',
    digest: 'fingerprint-a',
    ...overrides,
  };
}

describe('LocalItemApprovals', () => {
  let now: number;
  let nowSpy: jest.SpyInstance<number, []>;

  beforeEach(() => {
    now = 1_000_000;
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  it('issues an opaque id that carries none of the recorded data', () => {
    const approvals = new LocalItemApprovals();
    const id = approvals.register(item());
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(id).not.toContain('fingerprint');
    expect(approvals.peek(id, 'external', ROOT)).toMatchObject({
      approvalId: id,
      digest: 'fingerprint-a',
      relPath: '.claude/skills/api-design',
      createdAt: now,
      expiresAt: now + KEPT_ITEM_APPROVAL_TTL_MS,
    });
  });

  it('is family-bound: another family cannot see or consume the approval', () => {
    const approvals = new LocalItemApprovals();
    const id = approvals.register(item({ family: 'skills-sh' }));
    expect(approvals.take(id, 'external', ROOT)).toBeNull();
    expect(approvals.take(id, 'skills-sh', ROOT)).not.toBeNull();
  });

  it('is root-bound: an approval for one repository is unknown in another', () => {
    const approvals = new LocalItemApprovals();
    const id = approvals.register(item());
    expect(approvals.peek(id, 'external', '/workspace/other')).toBeNull();
    expect(approvals.peek(id, 'external', ROOT)).not.toBeNull();
  });

  it('authorizes at most one replace attempt', () => {
    const approvals = new LocalItemApprovals();
    const id = approvals.register(item());
    expect(approvals.take(id, 'external', ROOT)).not.toBeNull();
    expect(approvals.take(id, 'external', ROOT)).toBeNull();
  });

  it('expires a kept-report approval after 30 minutes', () => {
    const approvals = new LocalItemApprovals();
    const id = approvals.register(item());
    now += KEPT_ITEM_APPROVAL_TTL_MS;
    expect(approvals.peek(id, 'external', ROOT)).not.toBeNull();
    now += 1;
    expect(approvals.peek(id, 'external', ROOT)).toBeNull();
  });

  it('expires with the consent token when given its lifetime', () => {
    const approvals = new LocalItemApprovals();
    const id = approvals.register(item(), { ttlMs: 10_000 });
    now += 10_001;
    expect(approvals.take(id, 'external', ROOT)).toBeNull();
  });

  it(`keeps at most ${MAX_LOCAL_ITEM_APPROVALS} entries, evicting the oldest`, () => {
    const approvals = new LocalItemApprovals();
    const first = approvals.register(item({ relPath: 'first' }));
    const second = approvals.register(item({ relPath: 'second' }));
    for (let i = 2; i < MAX_LOCAL_ITEM_APPROVALS; i++) {
      approvals.register(item({ relPath: `n${i}` }));
    }
    expect(approvals.peek(first, 'external', ROOT)).not.toBeNull();

    const overflow = approvals.register(item({ relPath: 'overflow' }));
    expect(approvals.peek(first, 'external', ROOT)).toBeNull();
    expect(approvals.peek(second, 'external', ROOT)).not.toBeNull();
    expect(approvals.peek(overflow, 'external', ROOT)).not.toBeNull();
  });

  it('returns a copy, so a caller cannot rewrite the recorded digest', () => {
    const approvals = new LocalItemApprovals();
    const id = approvals.register(item());
    const peeked = approvals.peek(id, 'external', ROOT);
    if (peeked) peeked.digest = 'tampered';
    expect(approvals.peek(id, 'external', ROOT)?.digest).toBe('fingerprint-a');
  });
});

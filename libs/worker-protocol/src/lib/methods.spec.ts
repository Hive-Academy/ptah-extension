import {
  ADMIN_METHODS,
  PRE_AUTH_METHODS,
  REMOTE_METHODS,
  WORKER_METHOD_SCHEMAS,
  isAdminMethod,
  isPreAuthMethod,
  isRemoteMethod,
  isWorkerMethod,
  parseMethodParams,
  parseParams,
  parseResult,
} from './methods';

const grant = { machineId: 'm-1', workspaceIds: ['w-1'] };

describe('method groups', () => {
  it('splits the table into pre-auth, remote and admin with no overlap', () => {
    const all = [...PRE_AUTH_METHODS, ...REMOTE_METHODS, ...ADMIN_METHODS];
    expect(new Set(all).size).toBe(all.length);
    expect(all.sort()).toEqual(Object.keys(WORKER_METHOD_SCHEMAS).sort());
  });

  it('accepts only hello, pair.exchange and auth before authentication (W2)', () => {
    expect([...PRE_AUTH_METHODS]).toEqual(['hello', 'pair.exchange', 'auth']);
    expect(isPreAuthMethod('machine.info')).toBe(false);
    expect(isPreAuthMethod('chat:start')).toBe(false);
  });

  it('lists the W6 remote methods', () => {
    expect([...REMOTE_METHODS].sort()).toEqual(
      [
        'machine.info',
        'workspaces.list',
        'sessions.list',
        'session.attach',
        'session.detach',
        'session.start',
        'session.continue',
        'session.stop',
        'permission.respond',
        'token.revokeSelf',
      ].sort(),
    );
  });

  it('lists the W5 admin methods', () => {
    expect([...ADMIN_METHODS].sort()).toEqual(
      [
        'admin.pairing.open',
        'admin.grants.list',
        'admin.grants.add',
        'admin.grants.revoke',
        'admin.workspace.add',
        'admin.workspace.remove',
        'admin.status',
      ].sort(),
    );
    expect(isAdminMethod('admin.status')).toBe(true);
    expect(isRemoteMethod('admin.status')).toBe(false);
  });

  it('does not treat inherited object keys or in-process names as methods', () => {
    expect(isWorkerMethod('toString')).toBe(false);
    expect(isWorkerMethod('__proto__')).toBe(false);
    expect(isWorkerMethod('session:list')).toBe(false);
    expect(isWorkerMethod(1)).toBe(false);
  });
});

describe('parseMethodParams', () => {
  it('answers INVALID_PARAMS for an unknown method', () => {
    expect(parseMethodParams('chat:start', {})).toEqual({
      ok: false,
      code: 'INVALID_PARAMS',
    });
  });

  it('rejects unknown keys (strict params)', () => {
    expect(parseMethodParams('machine.info', {}).ok).toBe(true);
    expect(parseMethodParams('machine.info', { verbose: true }).ok).toBe(false);
    expect(
      parseMethodParams('session.stop', { sessionId: 's-1', force: true }).ok,
    ).toBe(false);
  });

  it('accepts allow and deny but not always_allow (design D4)', () => {
    const base = { sessionId: 's-1', requestId: 'r-1' };
    expect(
      parseMethodParams('permission.respond', { ...base, decision: 'allow' })
        .ok,
    ).toBe(true);
    expect(
      parseMethodParams('permission.respond', {
        ...base,
        decision: 'deny',
        reason: 'no',
      }).ok,
    ).toBe(true);
    expect(
      parseMethodParams('permission.respond', {
        ...base,
        decision: 'always_allow',
      }),
    ).toEqual({ ok: false, code: 'INVALID_PARAMS' });
  });

  it('validates the hello handshake', () => {
    const hello = {
      protocol: { min: 1, max: 1 },
      client: { name: 'ptah-electron', version: '1.2.0' },
    };
    expect(parseMethodParams('hello', hello).ok).toBe(true);
    expect(
      parseMethodParams('hello', { ...hello, protocol: { min: 2, max: 1 } }).ok,
    ).toBe(false);
    expect(parseMethodParams('hello', { protocol: hello.protocol }).ok).toBe(
      false,
    );
  });

  it('accepts either auth form but not both or neither', () => {
    expect(parseMethodParams('auth', { token: 'ptw1.abc.def' }).ok).toBe(true);
    expect(parseMethodParams('auth', { admin: 'key' }).ok).toBe(true);
    expect(parseMethodParams('auth', { token: 't', admin: 'k' }).ok).toBe(
      false,
    );
    expect(parseMethodParams('auth', {}).ok).toBe(false);
  });

  it('accepts any bounded pairing code string so the worker decides (S4)', () => {
    expect(
      parseMethodParams('pair.exchange', {
        code: 'ABCD-EFGH',
        clientName: 'Laptop',
      }).ok,
    ).toBe(true);
    expect(
      parseMethodParams('pair.exchange', {
        code: 'not-a-code',
        clientName: 'Laptop',
      }).ok,
    ).toBe(true);
    expect(
      parseMethodParams('pair.exchange', {
        code: 'x'.repeat(33),
        clientName: 'Laptop',
      }).ok,
    ).toBe(false);
  });

  it('bounds the pairing window ttl to 60-900 s', () => {
    expect(parseMethodParams('admin.pairing.open', {}).ok).toBe(true);
    expect(parseMethodParams('admin.pairing.open', { ttlSeconds: 60 }).ok).toBe(
      true,
    );
    expect(
      parseMethodParams('admin.pairing.open', { ttlSeconds: 900 }).ok,
    ).toBe(true);
    expect(parseMethodParams('admin.pairing.open', { ttlSeconds: 59 }).ok).toBe(
      false,
    );
    expect(
      parseMethodParams('admin.pairing.open', { ttlSeconds: 901 }).ok,
    ).toBe(false);
    expect(parseMethodParams('admin.pairing.open', { workspaces: [] }).ok).toBe(
      false,
    );
  });

  it('requires at least one workspace for admin.grants.add', () => {
    expect(
      parseMethodParams('admin.grants.add', {
        tokenId: 't-1',
        workspaces: ['w-2'],
      }).ok,
    ).toBe(true);
    expect(
      parseMethodParams('admin.grants.add', { tokenId: 't-1', workspaces: [] })
        .ok,
    ).toBe(false);
  });

  it('validates the Batch 21 admin revoke and workspace methods', () => {
    expect(
      parseMethodParams('admin.grants.revoke', { tokenId: 't-1' }).ok,
    ).toBe(true);
    expect(parseMethodParams('admin.grants.revoke', {}).ok).toBe(false);
    expect(
      parseMethodParams('admin.grants.revoke', { tokenId: 't-1', extra: 1 }).ok,
    ).toBe(false);
    expect(parseMethodParams('admin.workspace.add', { path: '/w' }).ok).toBe(
      true,
    );
    expect(parseMethodParams('admin.workspace.add', { path: '' }).ok).toBe(
      false,
    );
    expect(
      parseMethodParams('admin.workspace.remove', { workspace: 'ws_1' }).ok,
    ).toBe(true);
    expect(
      parseResult('admin.grants.revoke', {
        tokenId: 't-1',
        revokedAt: 1,
        connectionsClosed: 2,
      }).ok,
    ).toBe(true);
  });

  it('accepts session.attach with and without a replay point', () => {
    expect(parseMethodParams('session.attach', { sessionId: 's-1' }).ok).toBe(
      true,
    );
    expect(
      parseMethodParams('session.attach', {
        sessionId: 's-1',
        afterSeq: 4,
        epoch: 'e-1',
      }).ok,
    ).toBe(true);
    expect(
      parseMethodParams('session.attach', { sessionId: 's-1', afterSeq: -1 })
        .ok,
    ).toBe(false);
  });
});

describe('parseParams', () => {
  it('returns typed params for a known method', () => {
    const parsed = parseParams('session.continue', {
      sessionId: 's-1',
      prompt: 'hi',
    });
    expect(parsed).toEqual({
      ok: true,
      value: { sessionId: 's-1', prompt: 'hi' },
    });
    expect(
      parseParams('session.continue', { sessionId: 's-1', prompt: '' }).ok,
    ).toBe(false);
  });
});

describe('parseResult', () => {
  it('validates both session.attach modes', () => {
    expect(
      parseResult('session.attach', {
        mode: 'log',
        epoch: 'e-1',
        fromSeq: 1,
        headSeq: 9,
      }).ok,
    ).toBe(true);
    expect(
      parseResult('session.attach', {
        mode: 'snapshot',
        events: [
          {
            id: 'x',
            eventType: 'text_delta',
            timestamp: 1,
            messageId: 'm-1',
            delta: 'hi',
            blockIndex: 0,
          },
        ],
        live: false,
        drivenBy: 'Ptah desktop',
      }).ok,
    ).toBe(true);
    expect(
      parseResult('session.attach', {
        mode: 'snapshot',
        events: [],
        live: true,
      }).ok,
    ).toBe(false);
  });

  it('tolerates additive result fields from a newer worker', () => {
    const parsed = parseResult('session.start', {
      sessionId: 's-1',
      turnId: 't-1',
      extra: true,
    });
    expect(parsed).toEqual({
      ok: true,
      value: { sessionId: 's-1', turnId: 't-1' },
    });
  });

  it('marks a queued continue (W12 step 5)', () => {
    expect(
      parseResult('session.continue', { turnId: 't-1', queued: true }).ok,
    ).toBe(true);
    expect(
      parseResult('session.continue', { turnId: 't-1', queued: false }).ok,
    ).toBe(false);
  });

  it('distinguishes client and admin auth results', () => {
    expect(
      parseResult('auth', { role: 'client', tokenId: 't-1', grant }).ok,
    ).toBe(true);
    expect(parseResult('auth', { role: 'admin' }).ok).toBe(true);
    expect(parseResult('auth', { role: 'root' }).ok).toBe(false);
  });

  it('validates the status report with open and closed pairing windows', () => {
    const status = {
      machineId: 'm-1',
      displayName: 'Build box',
      ptahVersion: '1.4.0',
      protocol: 1,
      readiness: {
        ready: true,
        checks: [{ id: 'os', label: 'OS', status: 'pass' }],
      },
      grants: [
        {
          tokenId: 't-1',
          clientName: 'Laptop',
          createdAt: 1,
          lastUsedAt: null,
          grant,
        },
      ],
      locks: [
        { sessionId: 's-1', state: 'stranded', label: 'worker', acquiredAt: 1 },
      ],
    };
    expect(
      parseResult('admin.status', { ...status, pairing: { open: false } }).ok,
    ).toBe(true);
    expect(
      parseResult('admin.status', {
        ...status,
        pairing: { open: true, expiresAt: 10, attemptsLeft: 4 },
      }).ok,
    ).toBe(true);
    expect(
      parseResult('admin.status', { ...status, pairing: { open: true } }).ok,
    ).toBe(false);
  });

  it('never carries a token secret hash in the grants list', () => {
    const parsed = parseResult('admin.grants.list', [
      {
        tokenId: 't-1',
        clientName: 'Laptop',
        createdAt: 1,
        lastUsedAt: 2,
        grant,
        secretHash: 'deadbeef',
      },
    ]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value[0]).not.toHaveProperty('secretHash');
    }
  });
});

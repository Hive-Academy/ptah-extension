import { policy } from '../../tools/evidence-harness';
import {
  buildCodexExecutionProfile,
  codexProfileFingerprint,
  resolveCodexLevelPolicy,
  type CodexExecutionProfileInput,
  type CodexProfileSettings,
} from './codex-execution-profile';

function input(): CodexExecutionProfileInput {
  return {
    session: {
      contextId: 'chat-1',
      consumer: 'chat',
      providerId: 'openai',
      workspaceId: 'workspace-1',
      cwd: '/work',
      model: 'model',
      permissionLevel: 'ask',
    },
    defaultHome: '/home',
    paths: {
      platform: 'posix',
      baseDirectory: '/',
      entries: {
        '/work': { kind: 'directory', realpath: '/real/work' },
        '/home': { kind: 'directory', realpath: '/real/home' },
        '/file': { kind: 'file', realpath: '/real/file' },
        '/missing': { kind: 'missing' },
      },
    },
  };
}

describe('buildCodexExecutionProfile', () => {
  it.each(['chat', 'gateway'] as const)(
    'keeps the pre-change %s fingerprint for the same ask inputs',
    (consumer) => {
      const source = input();
      const profile = buildCodexExecutionProfile({
        ...source,
        session: { ...source.session, consumer },
      });
      // SHA-256 of the pre-change canonical D14 ask policy at /real/work.
      expect(profile.profileFingerprint).toBe(
        'sha256:0fbec108e7892de9508f32351f0042c4fe9fd45baf1a6cf4673ed50f5a9ad034',
      );
    },
  );

  it('keeps lane settings and policy isolated from chat and gateway profiles', () => {
    const source = input();
    const build = (consumer: 'chat' | 'gateway') =>
      buildCodexExecutionProfile({
        ...source,
        session: { ...source.session, consumer },
      });
    const chatBefore = build('chat');
    const gatewayBefore = build('gateway');
    const lane = buildCodexExecutionProfile({
      ...source,
      session: {
        ...source.session,
        consumer: 'lane',
        lane: {
          suppressedTools: ['agents', 'plugins', 'apps', 'skills'],
          agentsEnabled: false,
          pluginsEnabled: false,
          appsEnabled: false,
          includeSkillInstructions: false,
          disabledUserMcpServers: ['user.server'],
          autoCompactTokens: 100,
          toolOutputTokenLimit: 20,
          webSearch: 'disabled',
          explicitFullAccess: false,
        },
      },
    });
    expect(lane.sandboxPolicy).toEqual({
      mode: 'workspace-write',
      networkAccess: false,
      writableRoots: ['/real/work'],
    });
    expect(lane.approvalPolicy).toBe('never');
    expect(build('chat')).toEqual(chatBefore);
    expect(build('gateway')).toEqual(gatewayBefore);
  });

  it.each(
    (['chat', 'gateway', 'lane'] as const).flatMap((consumer) =>
      (['ask', 'plan', 'auto-edit', 'yolo'] as const).map(
        (permissionLevel) => [consumer, permissionLevel] as const,
      ),
    ),
  )(
    'resolves %s %s policy and preserves its fingerprint',
    (consumer, permissionLevel) => {
      const source = input();
      const profile = buildCodexExecutionProfile({
        ...source,
        session: { ...source.session, consumer, permissionLevel },
      });
      const resolved = resolveCodexLevelPolicy(
        consumer,
        permissionLevel,
        '/real/work',
      );
      const d14 = consumer === 'chat' || consumer === 'gateway';
      const writable =
        consumer === 'lane' ||
        permissionLevel === 'auto-edit' ||
        permissionLevel === 'yolo' ||
        (d14 && permissionLevel === 'ask');
      const granularAsk = consumer !== 'lane' && !d14 && permissionLevel === 'ask';
      expect(resolved.approvalPolicy).toEqual(
        granularAsk
          ? {
              granular: {
                sandbox_approval: true,
                rules: true,
                skill_approval: true,
                request_permissions: true,
                mcp_elicitations: true,
              },
            }
          : consumer === 'lane'
            ? 'never'
            : d14 &&
              (permissionLevel === 'ask' || permissionLevel === 'auto-edit')
            ? 'untrusted'
            : 'on-request',
      );
      expect(resolved.sandboxPolicy).toEqual({
        mode: writable ? 'workspace-write' : 'read-only',
        networkAccess: false,
        writableRoots: writable ? ['/real/work'] : [],
      });
      expect(profile).toMatchObject(resolved);
      expect(profile.profileFingerprint).toBe(
        codexProfileFingerprint({ permissionLevel, ...resolved }),
      );
    },
  );

  it.each(['ask', 'plan', 'auto-edit', 'yolo'] as const)(
    'matches observed harness policy for %s',
    (permissionLevel) => {
      const source = input();
      const profile = buildCodexExecutionProfile({
        ...source,
        session: { ...source.session, permissionLevel },
      });
      const observed = policy(permissionLevel);
      expect(profile.consumer).toBe('chat');
      expect(profile.approvalPolicy).toEqual(observed.approvalPolicy);
      expect(profile.approvalPolicy).toBe(
        permissionLevel === 'ask' || permissionLevel === 'auto-edit'
          ? 'untrusted'
          : 'on-request',
      );
      expect(profile.sandboxPolicy.mode).toBe(observed.sandbox);
      expect(profile.sandboxPolicy.mode).toBe(
        permissionLevel === 'plan' ? 'read-only' : 'workspace-write',
      );
      expect(profile.sandboxPolicy.networkAccess).toBe(false);
      expect(profile.approvalsReviewer).toBe('user');
      expect(observed.approvalsReviewer).toBe('user');
      expect(profile.fullAccessStatus).toBe('unproved-disabled');
      expect(profile.sandboxPolicy.writableRoots).toEqual(
        permissionLevel === 'plan' ? [] : ['/real/work'],
      );
    },
  );

  it.each(['lane', 'usage'] as const)(
    'uses the consumer-specific auto-edit mapping for %s',
    (consumer) => {
      const source = input();
      const profile = buildCodexExecutionProfile({
        ...source,
        session: {
          ...source.session,
          consumer,
          permissionLevel: 'auto-edit',
        },
      });
      expect(profile.approvalPolicy).toBe(
        consumer === 'lane' ? 'never' : 'on-request',
      );
      expect(profile.sandboxPolicy).toEqual({
        mode: 'workspace-write',
        networkAccess: false,
        writableRoots: ['/real/work'],
      });
      expect(profile.fullAccessStatus).toBe('unproved-disabled');
    },
  );

  it.each(['lane', 'usage'] as const)(
    'uses the consumer-specific ask mapping for %s',
    (consumer) => {
      const source = input();
      const profile = buildCodexExecutionProfile({
        ...source,
        session: { ...source.session, consumer, permissionLevel: 'ask' },
      });
      expect(profile.approvalPolicy).toEqual(
        consumer === 'lane'
          ? 'never'
          : {
              granular: {
                sandbox_approval: true,
                rules: true,
                skill_approval: true,
                request_permissions: true,
                mcp_elicitations: true,
              },
            },
      );
      expect(profile.sandboxPolicy.mode).toBe(
        consumer === 'lane' ? 'workspace-write' : 'read-only',
      );
      expect(profile.sandboxPolicy.writableRoots).toEqual(
        consumer === 'lane' ? ['/real/work'] : [],
      );
    },
  );

  it('distinguishes Manual and plan thread fingerprints', () => {
    const source = input();
    const ask = buildCodexExecutionProfile(source);
    const plan = buildCodexExecutionProfile({
      ...source,
      session: { ...source.session, permissionLevel: 'plan' },
    });
    expect(ask.profileFingerprint).not.toBe(plan.profileFingerprint);
  });

  it('applies precedence without injecting absent defaults from higher layers', () => {
    const source = input();
    const profile = buildCodexExecutionProfile({
      ...source,
      defaults: {
        model: 'default',
        effort: 'low',
        outputStyle: 'short',
        instructionSources: [{ kind: 'inline', name: 'base', content: 'keep' }],
      },
      resolved: { model: 'resolved', effort: 'medium', outputStyle: 'long' },
      session: { ...source.session, outputStyle: '', effort: undefined },
    });
    expect(profile.model).toBe('model');
    expect(profile.effort).toBe('medium');
    expect(profile.outputStyle).toBe('');
    expect(profile.instructionSources).toEqual([
      { kind: 'inline', name: 'base', content: 'keep' },
    ]);
  });

  it('preserves prompts, instructions, attachments and all MCP references without editing or freezing input', () => {
    const source = input();
    const session: Partial<CodexProfileSettings> = {
      ...source.session,
      enhancedPrompt: 'enhanced',
      systemPrompt: 'system',
      developerPrompt: 'developer',
      instructionSources: [
        { kind: 'skill' as const, name: 'skill', content: 'instructions' },
      ],
      attachments: [
        { type: 'image' as const, data: 'base64', mediaType: 'image/png' },
        { type: 'file' as const, path: '/file' },
      ],
      mcpServers: [
        {
          name: 'local',
          transport: 'stdio' as const,
          command: 'server',
          args: ['--flag'],
          envReferences: { TOKEN: 'vault:local' },
        },
        {
          name: 'remote',
          transport: 'http' as const,
          url: 'https://example.com/mcp',
          headerReferences: { Authorization: 'vault:header' },
          authReference: 'oauth:account',
        },
        {
          name: 'smithery',
          transport: 'sse' as const,
          url: 'https://example.com/sse',
          headerReferences: {},
        },
      ],
    };
    const before = JSON.stringify(session);
    const profile = buildCodexExecutionProfile({ ...source, session });
    expect(profile).toMatchObject({
      enhancedPrompt: 'enhanced',
      systemPrompt: 'system',
      developerPrompt: 'developer',
      mcpServers: session.mcpServers,
      instructionSources: session.instructionSources,
    });
    expect(profile.attachments[1]).toEqual({
      type: 'file',
      path: '/real/file',
    });
    expect(JSON.stringify(session)).toBe(before);
    const server = session.mcpServers?.[0];
    if (server?.transport === 'stdio') server.args.push('later');
    expect(profile.mcpServers).not.toEqual(session.mcpServers);
    const assertFrozen = (value: unknown): void => {
      if (value !== null && typeof value === 'object') {
        expect(Object.isFrozen(value)).toBe(true);
        Object.values(value).forEach(assertFrozen);
      }
    };
    assertFrozen(profile);
    expect(Object.isFrozen(session)).toBe(false);
  });

  it('uses explicit home then captured home then resolver home and resolves missing paths', () => {
    const source = input();
    expect(
      buildCodexExecutionProfile({ ...source, capturedCodexHome: '/missing' })
        .normalizedHome,
    ).toBe('/missing');
    expect(
      buildCodexExecutionProfile({
        ...source,
        capturedCodexHome: '/missing',
        session: { ...source.session, normalizedHome: '/home' },
      }).normalizedHome,
    ).toBe('/real/home');
    expect(buildCodexExecutionProfile(source).normalizedHome).toBe(
      '/real/home',
    );
  });

  it('preserves Windows cwd case and folds home identity and resolves relative paths from an explicit base', () => {
    const source = input();
    const profile = buildCodexExecutionProfile({
      ...source,
      defaultHome: 'Home',
      session: { ...source.session, cwd: 'Work/../Work' },
      paths: {
        platform: 'win32',
        baseDirectory: 'C:\\Root',
        entries: {
          'C:\\Root\\Work': { kind: 'directory', realpath: 'C:\\Actual\\Work' },
          'C:\\Root\\Home': { kind: 'missing' },
        },
      },
    });
    expect(profile.cwd).toBe('C:\\Actual\\Work');
    expect(profile.normalizedHome).toBe('c:\\root\\home');
  });

  it.each(['/missing', '/file', '/unobserved', '~/work', '$HOME/work'])(
    'rejects invalid workspace %s before any runtime work',
    (cwd) => {
      const source = input();
      expect(() =>
        buildCodexExecutionProfile({
          ...source,
          session: { ...source.session, cwd },
        }),
      ).toThrow();
    },
  );

  it('retains lane budgets but never enables full access or chat suppression', () => {
    const source = input();
    const lane = {
      suppressedTools: ['tool'],
      maxTurns: 3,
      maxBudgetUsd: 2,
      explicitFullAccess: false,
    };
    expect(
      buildCodexExecutionProfile({
        ...source,
        session: { ...source.session, consumer: 'lane', lane },
      }).lane,
    ).toEqual(lane);
    expect(() =>
      buildCodexExecutionProfile({
        ...source,
        session: { ...source.session, lane },
      }),
    ).toThrow('Lane settings');
    expect(() =>
      buildCodexExecutionProfile({
        ...source,
        session: {
          ...source.session,
          consumer: 'lane',
          lane: { ...lane, explicitFullAccess: true },
        },
      }),
    ).toThrow('unproved');
  });

  it('keeps resume identity fixed while model and effort produce a new immutable profile', () => {
    const source = input();
    const resume = buildCodexExecutionProfile(source);
    const revised = buildCodexExecutionProfile({
      ...source,
      resume,
      session: {
        ...source.session,
        model: 'next',
        effort: 'high',
        enhancedPrompt: 'next turn',
        attachments: [{ type: 'file', path: '/file' }],
      },
    });
    expect(revised.profileFingerprint).toBe(resume.profileFingerprint);
    expect(resume.model).toBe('model');
    for (const patch of [
      { contextId: 'other' },
      { consumer: 'lane' as const },
      { accountId: 'other' },
      { providerId: 'other' },
      { workspaceId: 'other' },
      { normalizedHome: '/missing' },
    ]) {
      expect(() =>
        buildCodexExecutionProfile({
          ...source,
          resume,
          session: { ...source.session, ...patch },
        }),
      ).toThrow('Resume');
    }
  });

  it('fingerprints execution policy, ignoring per-open MCP servers', () => {
    const source = input();
    const fingerprint = (session: Partial<CodexProfileSettings> = {}): string =>
      buildCodexExecutionProfile({
        ...source,
        session: { ...source.session, ...session },
      }).profileFingerprint;
    const baseline = fingerprint();
    // DL3: servers, references, urls and timeouts are re-applied per open, so
    // a changed tab id or an added user server never blocks resume.
    expect(
      fingerprint({
        mcpServers: [
          {
            name: 'remote',
            transport: 'http',
            url: 'https://example.com',
            headerReferences: { A: 'ref:a', B: 'ref:b' },
          },
        ],
      }),
    ).toBe(baseline);
    expect(
      fingerprint({
        mcpServers: [
          {
            name: 'remote',
            transport: 'http',
            url: 'https://other.example.com/path',
            urlReference: 'vault:url',
            headerReferences: { B: 'ref:b', A: 'ref:c' },
            toolTimeoutSec: 960,
          },
          {
            name: 'local',
            transport: 'stdio',
            command: 'server',
            args: ['--flag'],
            envReferences: { TOKEN: 'vault:token' },
          },
        ],
      }),
    ).toBe(baseline);
    const original = buildCodexExecutionProfile(source);
    const other = buildCodexExecutionProfile({
      ...source,
      session: { ...source.session, contextId: 'chat-2' },
    });
    expect(original.normalizedHome).toBe(other.normalizedHome);
    expect(original.profileFingerprint).toBe(other.profileFingerprint);
    expect(buildCodexExecutionProfile(source).profileFingerprint).toBe(original.profileFingerprint);
    expect(original.profileFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('accepts tool timeouts and url references and rejects unsafe server names', () => {
    const source = input();
    const profile = buildCodexExecutionProfile({
      ...source,
      session: {
        ...source.session,
        mcpServers: [
          {
            name: 'remote-1',
            transport: 'http',
            url: 'https://example.com/mcp',
            urlReference: 'vault:url',
            headerReferences: { 'X-Api-Key': 'vault:key' },
            authReference: 'oauth:account',
            toolTimeoutSec: 30,
          },
          {
            name: 'local_server',
            transport: 'stdio',
            command: 'server',
            args: ['--flag'],
            envReferences: { TOKEN: 'vault:token' },
            toolTimeoutSec: 960,
          },
        ],
      },
    });
    expect(profile.mcpServers).toEqual([
      {
        name: 'remote-1',
        transport: 'http',
        url: 'https://example.com/mcp',
        urlReference: 'vault:url',
        headerReferences: { 'X-Api-Key': 'vault:key' },
        authReference: 'oauth:account',
        toolTimeoutSec: 30,
      },
      {
        name: 'local_server',
        transport: 'stdio',
        command: 'server',
        args: ['--flag'],
        envReferences: { TOKEN: 'vault:token' },
        toolTimeoutSec: 960,
      },
    ]);
    const assertFrozen = (value: unknown): void => {
      if (value !== null && typeof value === 'object') {
        expect(Object.isFrozen(value)).toBe(true);
        Object.values(value).forEach(assertFrozen);
      }
    };
    assertFrozen(profile.mcpServers);
    for (const name of ['two words', 'ptah.server', 'naïve', 'name\ttab']) {
      expect(() =>
        buildCodexExecutionProfile({
          ...source,
          session: {
            ...source.session,
            mcpServers: [
              {
                name,
                transport: 'http',
                url: 'https://example.com/mcp',
                headerReferences: {},
              },
            ],
          },
        }),
      ).toThrow('Invalid Codex execution profile input');
    }
  });

  it('keeps the fingerprint across instructions and turn settings', () => {
    const source = input();
    const original = buildCodexExecutionProfile(source);
    for (const patch of [
      { systemPrompt: 'new system instruction' },
      { developerPrompt: 'new developer instruction' },
      { outputStyle: 'brief' },
      { model: 'another model' },
      { effort: 'high' },
      {
        instructionSources: [
          { kind: 'inline' as const, name: 'role', content: 'new role' },
        ],
      },
    ]) {
      expect(
        buildCodexExecutionProfile({
          ...source,
          session: { ...source.session, ...patch },
        }).profileFingerprint,
      ).toBe(original.profileFingerprint);
    }
  });

  it('changes the fingerprint for permission, sandbox, or approval policy', () => {
    const source = input();
    const ask = buildCodexExecutionProfile(source);
    const autoEdit = buildCodexExecutionProfile({
      ...source,
      session: { ...source.session, permissionLevel: 'auto-edit' },
    });
    expect(autoEdit.sandboxPolicy).toEqual(ask.sandboxPolicy);
    expect(autoEdit.approvalPolicy).toEqual(ask.approvalPolicy);
    expect(autoEdit.profileFingerprint).not.toBe(ask.profileFingerprint);

    const yolo = buildCodexExecutionProfile({
      ...source,
      session: { ...source.session, permissionLevel: 'yolo' },
    });
    expect(yolo.profileFingerprint).not.toBe(ask.profileFingerprint);

    const otherWorkspace = buildCodexExecutionProfile({
      ...source,
      session: { ...source.session, cwd: '/other' },
      paths: {
        ...source.paths,
        entries: {
          ...source.paths.entries,
          '/other': { kind: 'directory', realpath: '/real/other' },
        },
      },
    });
    expect(otherWorkspace.permissionLevel).toBe(ask.permissionLevel);
    expect(otherWorkspace.approvalPolicy).toEqual(ask.approvalPolicy);
    expect(otherWorkspace.sandboxPolicy).not.toEqual(ask.sandboxPolicy);
    expect(otherWorkspace.profileFingerprint).not.toBe(ask.profileFingerprint);
  });

  it.each(['ask', 'plan', 'auto-edit', 'yolo'] as const)(
    'gives gateway the same %s policy, sandbox and fingerprint as chat',
    (permissionLevel) => {
      const source = input();
      const chat = buildCodexExecutionProfile({
        ...source,
        session: { ...source.session, consumer: 'chat', permissionLevel },
      });
      const gateway = buildCodexExecutionProfile({
        ...source,
        session: { ...source.session, consumer: 'gateway', permissionLevel },
      });
      expect(gateway.approvalPolicy).toEqual(chat.approvalPolicy);
      expect(gateway.sandboxPolicy).toEqual(chat.sandboxPolicy);
      expect(gateway.profileFingerprint).toBe(chat.profileFingerprint);
    },
  );

  it('rejects malformed input and credential-bearing URLs with sanitized errors', () => {
    const source = input();
    expect(() =>
      buildCodexExecutionProfile({
        ...source,
        session: { ...source.session, model: ' ' },
      }),
    ).toThrow('Invalid Codex');
    for (const url of [
      'https://user:secret@example.com',
      'https://example.com?token=secret',
    ]) {
      expect(() =>
        buildCodexExecutionProfile({
          ...source,
          session: {
            ...source.session,
            mcpServers: [
              { name: 'remote', transport: 'http', url, headerReferences: {} },
            ],
          },
        }),
      ).toThrow('Invalid Codex execution profile input');
    }
  });
});

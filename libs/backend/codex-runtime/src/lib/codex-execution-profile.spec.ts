import { policy } from '../../tools/evidence-harness';
import {
  buildCodexExecutionProfile,
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
  it.each(['ask', 'plan', 'auto-edit', 'yolo'] as const)(
    'matches observed harness policy for %s',
    (permissionLevel) => {
      const source = input();
      const profile = buildCodexExecutionProfile({
        ...source,
        session: { ...source.session, permissionLevel },
      });
      const observed = policy(permissionLevel);
      expect(profile.approvalPolicy).toEqual(observed.approvalPolicy);
      expect(profile.sandboxPolicy.mode).toBe(observed.sandbox);
      expect(profile.sandboxPolicy.networkAccess).toBe(false);
      expect(profile.approvalsReviewer).toBe('user');
      expect(profile.fullAccessStatus).toBe('unproved-disabled');
      expect(profile.sandboxPolicy.writableRoots).toEqual(
        ['auto-edit', 'yolo'].includes(permissionLevel) ? ['/real/work'] : [],
      );
    },
  );

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

  it('fingerprints thread policy and instructions, ignoring per-open MCP servers', () => {
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
    expect(original.profileFingerprint).not.toBe(other.profileFingerprint);
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

  it('changes identity when thread policy or instructions change', () => {
    const source = input();
    const original = buildCodexExecutionProfile(source);
    for (const patch of [
      { permissionLevel: 'auto-edit' as const },
      { systemPrompt: 'new system instruction' },
      { developerPrompt: 'new developer instruction' },
      { outputStyle: 'brief' },
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
      ).not.toBe(original.profileFingerprint);
    }
  });

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

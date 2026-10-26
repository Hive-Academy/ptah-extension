import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CommandCenterVoiceSessionService, TabManagerService } from '@ptah-extension/chat-state';
import { AgentMonitorStore, PermissionHandlerService } from '@ptah-extension/chat-streaming';
import { AttentionItem, NotificationService, SURFACE_FOCUS_ROUTER, VSCodeService } from '@ptah-extension/core';
import type { AskUserQuestionRequest, PermissionRequest } from '@ptah-extension/shared';
import { ChatAttentionSourceService } from './chat-attention-source.service';

describe('ChatAttentionSourceService', () => {
  const permissions = signal<PermissionRequest[]>([]);
  const questions = signal<AskUserQuestionRequest[]>([]);
  const lanes = signal<{ agentId: string; parentSessionId: string; permissionQueue: {
    requestId: string; toolName: string; timestamp: number;
  }[] }[]>([]);
  const revision = signal(0);
  const tabs = signal([{ id: 'tab-1', claudeSessionId: 'session-1', title: 'Fix notifications',
    titleOrigin: 'user', providerId: 'claude-cli' }]);
  const activeWorkspacePath = signal<string | null>('/ws/one');
  let ownerWorkspacePath: string | null = '/ws/one';
  let ownerAvailable = true;
  const configuredWorkspaceRoot = signal('');
  const upsert = jest.fn<void, [AttentionItem]>();
  const resolve = jest.fn<void, [string, number, string]>();
  const setSnackbarSuppressed = jest.fn();
  const voice = jest.fn<boolean, [string]>(() => false);

  beforeEach(() => {
    tabs.set([{ id: 'tab-1', claudeSessionId: 'session-1', title: 'Fix notifications',
      titleOrigin: 'user', providerId: 'claude-cli' }]);
    permissions.set([]);
    questions.set([]);
    lanes.set([]);
    revision.set(0);
    activeWorkspacePath.set('/ws/one');
    ownerWorkspacePath = '/ws/one';
    ownerAvailable = true;
    configuredWorkspaceRoot.set('');
    upsert.mockClear();
    resolve.mockClear();
    voice.mockReset().mockReturnValue(false);
    TestBed.configureTestingModule({ providers: [
      { provide: PermissionHandlerService, useValue: {
        permissionRequests: permissions, questionRequests: questions,
        routingTargetRevision: revision, targetTabsFor: () => [], questionTargetTabsFor: () => [],
      } },
      { provide: AgentMonitorStore, useValue: { pendingPermissions: lanes } },
      { provide: TabManagerService, useValue: {
        tabs, get activeWorkspacePath() { return activeWorkspacePath(); }, activeWorkspacePath$: activeWorkspacePath,
        activeTabId: signal('tab-1'), visibleTabIds: signal(new Set<string>()), findTabByIdAcrossWorkspaces: (id: string) =>
          ownerAvailable && id === 'tab-1' ? { tab: tabs()[0], workspacePath: ownerWorkspacePath } : null,
        findTabBySessionIdAcrossWorkspaces: (id: string) =>
          ownerAvailable && id === 'session-1' && (ownerWorkspacePath !== null || tabs().some(tab => tab.claudeSessionId === id))
            ? { tab: tabs()[0], workspacePath: ownerWorkspacePath } : null,
      } },
      { provide: CommandCenterVoiceSessionService, useValue: { isActive: voice } },
      { provide: NotificationService, useValue: { upsert, resolve, setSnackbarSuppressed } },
      { provide: VSCodeService, useValue: { config: () => ({ workspaceRoot: configuredWorkspaceRoot() }) } },
      { provide: SURFACE_FOCUS_ROUTER, useValue: {
        kind: 'mcp-apps', canFocus: (id: string) => id === 'apps-session',
        focus: jest.fn(),
      }, multi: true },
    ] });
  });

  it('publishes one keyed request, mutes active voice, and resolves withdrawal', () => {
    voice.mockReturnValue(true);
    const source = TestBed.inject(ChatAttentionSourceService);
    const request: PermissionRequest = {
      id: 'p1', toolName: 'Write', toolInput: {}, timestamp: 1,
      timeoutAt: 0, description: 'private details', tabId: 'tab-1', sessionId: 'session-1',
    };
    permissions.set([request]);
    TestBed.tick();
    const item = upsert.mock.lastCall?.[0];
    if (!item) throw new Error('Missing attention item');
    expect(item).toMatchObject({ kind: 'permission', workspacePath: '/ws/one', soundEligible: false });
    expect(item.actions.find(action => action.id === 'open')?.label).toBe('Show in canvas');
    expect(item).toMatchObject({ sessionTitle: 'Fix notifications', provider: 'Claude', detail: 'Tool: Write' });
    expect(item.context).toBe('Claude · Fix notifications · Tool: Write');
    expect(item.title).not.toContain('private details');
    expect(source.getLive(item.key, item.generation)?.target.kind).toBe('permission');
    permissions.set([]);
    TestBed.tick();
    expect(resolve).toHaveBeenCalledWith(item.key, item.generation, 'chat');
    expect(source.getLive(item.key, item.generation)).toBeUndefined();
  });

  it('uses a new generation when the same request id reappears', () => {
    TestBed.inject(ChatAttentionSourceService);
    const request: PermissionRequest = {
      id: 'p2', toolName: 'Read', toolInput: {}, timestamp: 1,
      timeoutAt: 0, description: '', tabId: 'tab-1',
    };
    permissions.set([request]); TestBed.tick();
    const first = upsert.mock.lastCall?.[0];
    if (!first) throw new Error('Missing first attention item');
    permissions.set([]); TestBed.tick();
    permissions.set([request]); TestBed.tick();
    expect(upsert.mock.lastCall?.[0].generation).toBeGreaterThan(first.generation);
  });

  it('keeps a queued permission answerable after its target tab closes', () => {
    TestBed.inject(ChatAttentionSourceService);
    permissions.set([{ id: 'closed-tab', toolName: 'Bash', toolInput: { command: 'echo approved' }, timestamp: 1,
      timeoutAt: 0, description: 'Run approved command', tabId: 'tab-1', sessionId: 'session-1' }]);
    TestBed.tick();
    ownerAvailable = false;
    tabs.set([]);
    TestBed.tick();
    const item = upsert.mock.lastCall?.[0];
    expect(item?.tabId).toBeUndefined();
    expect(item?.workspacePath).toBe('/ws/one');
    expect(item?.permissionPreview).toContain('Input: echo approved');
    expect(item?.permissionPreview).toContain('Description: Run approved command');
    expect(item?.actions.map(action => action.id)).toEqual(['allow', 'always_allow', 'deny', 'deny_with_message', 'open']);
    expect(item?.actions.find(action => action.id === 'allow')?.disabledReason).toBeUndefined();
    expect(item?.actions.find(action => action.id === 'deny')?.disabledReason).toBeUndefined();
    expect(item?.actions.find(action => action.id === 'open')?.disabledReason).toBe('Session unavailable');
    permissions.set([{ id: 'unknown-tool', toolName: '', toolInput: {}, timestamp: 1,
      timeoutAt: 0, description: '', tabId: 'tab-1' }]);
    TestBed.tick();
    expect(upsert.mock.lastCall?.[0].actions.find(action => action.id === 'allow')?.disabledReason).toBeUndefined();
  });

  it('renders exactly the allowed native decisions and no message control', () => {
    TestBed.inject(ChatAttentionSourceService);
    permissions.set([{ id: 'codex-1', toolName: 'Bash', toolInput: { command: 'ls' }, timestamp: 1,
      timeoutAt: 0, description: '', tabId: 'tab-1', sessionId: 'session-1',
      allowedDecisions: ['cancel', 'accept', 'decline'] }]);
    TestBed.tick();
    const item = upsert.mock.lastCall?.[0];
    expect(item?.actions.map(action => [action.id, action.label])).toEqual([
      ['allow', 'Accept'], ['deny', 'Decline'], ['cancel', 'Cancel'], ['open', 'Show in canvas'],
    ]);
    expect(item?.actions.some(action => action.id === 'deny_with_message' || action.id === 'always_allow')).toBe(false);
  });

  it('labels all four native decisions', () => {
    TestBed.inject(ChatAttentionSourceService);
    permissions.set([{ id: 'codex-2', toolName: 'Bash', toolInput: {}, timestamp: 1, timeoutAt: 0,
      description: '', tabId: 'tab-1', allowedDecisions: ['accept', 'acceptForSession', 'decline', 'cancel'] }]);
    TestBed.tick();
    expect(upsert.mock.lastCall?.[0].actions.map(action => action.label)).toEqual(
      ['Accept', 'Accept for session', 'Decline', 'Cancel', 'Show in canvas']);
  });

  it('keeps session unavailable ahead of unknown tool for a tabless lane', () => {
    TestBed.inject(ChatAttentionSourceService);
    ownerAvailable = false;
    tabs.set([]);
    lanes.set([{ agentId: 'agent', parentSessionId: 'session-1', permissionQueue: [
      { requestId: 'missing-lane', toolName: '', timestamp: 1 },
    ] }]);
    TestBed.tick();
    const item = upsert.mock.lastCall?.[0];
    expect(item?.kind).toBe('lane-permission');
    expect(item?.actions.find(action => action.id === 'allow')?.disabledReason).toBe('Session unavailable');
  });

  it('shows shortened relative and Windows file paths in the permission preview', () => {
    TestBed.inject(ChatAttentionSourceService);
    permissions.set([{ id: 'relative', toolName: 'Write', toolInput: { file_path: 'src/main.ts' },
      timestamp: 1, timeoutAt: 0, description: '', tabId: 'tab-1', sessionId: 'session-1' }]);
    TestBed.tick();
    expect(upsert.mock.lastCall?.[0].permissionPreview).toBe('Input: src/main.ts');
    permissions.set([{ id: 'windows', toolName: 'Read', toolInput: { file_path: 'C:\\repo\\src\\main.ts' },
      timestamp: 1, timeoutAt: 0, description: '', tabId: 'tab-1', sessionId: 'session-1' }]);
    TestBed.tick();
    expect(upsert.mock.lastCall?.[0].permissionPreview).toBe('Input: .../src/main.ts');
  });

  it('shows path-bearing commands and redacts assigned, flagged, and token-shaped secrets', () => {
    TestBed.inject(ChatAttentionSourceService);
    permissions.set([{ id: 'command', toolName: 'Bash', toolInput: { command: 'rm -rf /tmp/foo' },
      timestamp: 1, timeoutAt: 0, description: '', tabId: 'tab-1', sessionId: 'session-1' }]);
    TestBed.tick();
    expect(upsert.mock.lastCall?.[0].permissionPreview).toBe('Input: rm -rf /tmp/foo');
    permissions.set([{ id: 'assigned', toolName: 'Bash', toolInput: { command: ['run password=', 'hunter2', ' --token ', 'abc123'].join('') },
      timestamp: 1, timeoutAt: 0, description: '', tabId: 'tab-1', sessionId: 'session-1' }]);
    TestBed.tick();
    expect(upsert.mock.lastCall?.[0].permissionPreview).toBe('Input: run password=*** --token ***');
    permissions.set([{ id: 'token-shape', toolName: 'Bash', toolInput: { command: ['echo sk-', '123456789abcdef'].join('') },
      timestamp: 1, timeoutAt: 0, description: '', tabId: 'tab-1', sessionId: 'session-1' }]);
    TestBed.tick();
    expect(upsert.mock.lastCall?.[0].permissionPreview).toBe('Input: echo ***');
  });

  it.each([
    { parts: ['GITHUB', '_TOKEN=', 'x'.repeat(8)], preview: 'Input: GITHUB_TOKEN=***' },
    { parts: ['DB', '_PASSWORD=', 'x'.repeat(8)], preview: 'Input: DB_PASSWORD=***' },
    { parts: ['AWS', '_SECRET_ACCESS_KEY=', 'x'.repeat(8)], preview: 'Input: AWS_SECRET_ACCESS_KEY=***' },
    { parts: ['--api', '-token ', 'x'.repeat(8)], preview: 'Input: --api-token ***' },
    { parts: ['--client', '-secret ', 'x'.repeat(8)], preview: 'Input: --client-secret ***' },
    { parts: ['TOKEN', '_BACKUP=', 'x'.repeat(8)], preview: 'Input: TOKEN_BACKUP=***' },
  ])('redacts prefixed and suffixed sensitive keys in $preview', ({ parts, preview }) => {
    TestBed.inject(ChatAttentionSourceService);
    permissions.set([{ id: 'sensitive-key', toolName: 'Bash', toolInput: { command: parts.join('') },
      timestamp: 1, timeoutAt: 0, description: '', tabId: 'tab-1', sessionId: 'session-1' }]);
    TestBed.tick();
    expect(upsert.mock.lastCall?.[0].permissionPreview).toBe(preview);
  });

  it.each([
    'git log --author alice', 'git commit author=alice', 'count tokens=5', 'set secretary=bob',
  ])('keeps ordinary words that only start with a sensitive key: %s', command => {
    TestBed.inject(ChatAttentionSourceService);
    permissions.set([{ id: 'ordinary-word', toolName: 'Bash', toolInput: { command },
      timestamp: 1, timeoutAt: 0, description: '', tabId: 'tab-1', sessionId: 'session-1' }]);
    TestBed.tick();
    expect(upsert.mock.lastCall?.[0].permissionPreview).toBe(`Input: ${command}`);
  });

  it('maps questions to Answer and lanes to Allow/Deny/Open', () => {
    TestBed.inject(ChatAttentionSourceService);
    questions.set([{ id: 'q1', toolName: 'AskUserQuestion', questions: [{
      question: `Which option should we choose? ${'long '.repeat(20)}`, header: 'Choice',
      options: [], multiSelect: false,
    }],
      timestamp: 1, timeoutAt: 0, tabId: 'tab-1' }]);
    lanes.set([{ agentId: 'agent', parentSessionId: 'session-1', permissionQueue: [
      { requestId: 'l1', toolName: 'Bash', timestamp: 1 },
    ] }]);
    TestBed.tick();
    const items = upsert.mock.calls.map(call => call[0]);
    expect(items.find(item => item.kind === 'question')?.actions.map((action: { id: string }) => action.id))
      .toEqual(['answer', 'open']);
    expect(items.find(item => item.kind === 'lane-permission')?.actions.map((action: { id: string }) => action.id))
      .toEqual(['allow', 'deny', 'open']);
    expect(items.find(item => item.kind === 'question')?.context).toMatch(/^Claude · Fix notifications · Which option should we choose\?/);
    expect(items.find(item => item.kind === 'question')).toMatchObject({ sessionTitle: 'Fix notifications', provider: 'Claude' });
    expect(items.find(item => item.kind === 'question')?.detail).toMatch(/^Which option should we choose\?/);
    expect(items.find(item => item.kind === 'question')?.context).toHaveLength(80);
    expect(items.find(item => item.kind === 'question')?.context).toMatch(/…$/);
    expect(items.find(item => item.kind === 'lane-permission')?.context)
      .toBe('Claude · Fix notifications · Tool: Bash');
    expect(items.find(item => item.kind === 'lane-permission')?.detail).toBe('Tool: Bash');
  });

  it('uses the background owner workspace before the active workspace', () => {
    ownerWorkspacePath = '/ws/background';
    TestBed.inject(ChatAttentionSourceService);
    permissions.set([{ id: 'background', toolName: 'Bash', toolInput: {}, timestamp: 1,
      timeoutAt: 0, description: '', tabId: 'tab-1', sessionId: 'session-1' }]);
    TestBed.tick();
    expect(upsert.mock.lastCall?.[0]).toMatchObject({ workspacePath: '/ws/background', workspaceName: 'background' });
  });

  it('keeps an unmatched request workspace unknown even when another workspace is active', () => {
    ownerAvailable = false;
    activeWorkspacePath.set('/ws/active');
    TestBed.inject(ChatAttentionSourceService);
    permissions.set([{ id: 'active', toolName: 'Read', toolInput: {}, timestamp: 1,
      timeoutAt: 0, description: '', sessionId: 'missing' }]);
    TestBed.tick();
    expect(upsert.mock.lastCall?.[0]).toMatchObject({ workspacePath: '', workspaceName: 'Unknown workspace' });
  });

  it('uses the renderer workspace root when the partition has no active workspace', () => {
    ownerWorkspacePath = null;
    activeWorkspacePath.set(null);
    configuredWorkspaceRoot.set('/ws/electron');
    TestBed.inject(ChatAttentionSourceService);
    permissions.set([{ id: 'electron', toolName: 'Read', toolInput: {}, timestamp: 1,
      timeoutAt: 0, description: '', tabId: 'tab-1', sessionId: 'session-1' }]);
    TestBed.tick();
    expect(upsert.mock.lastCall?.[0]).toMatchObject({ workspacePath: '', workspaceName: 'electron', tabId: 'tab-1' });
  });

  it('uses the active workspace label for an owner in the unpartitioned tab set', () => {
    ownerWorkspacePath = null;
    activeWorkspacePath.set('/ws/active');
    TestBed.inject(ChatAttentionSourceService);
    permissions.set([{ id: 'unpartitioned', toolName: 'Read', toolInput: {}, timestamp: 1,
      timeoutAt: 0, description: '', tabId: 'tab-1', sessionId: 'session-1' }]);
    TestBed.tick();
    expect(upsert.mock.lastCall?.[0]).toMatchObject({ workspacePath: '', workspaceName: 'active', tabId: 'tab-1' });
  });

  it('reconciles an unpartitioned owner when the renderer root arrives later', () => {
    ownerWorkspacePath = null;
    activeWorkspacePath.set(null);
    TestBed.inject(ChatAttentionSourceService);
    permissions.set([{ id: 'late-root', toolName: 'Read', toolInput: {}, timestamp: 1,
      timeoutAt: 0, description: '', tabId: 'tab-1', sessionId: 'session-1' }]);
    TestBed.tick();
    expect(upsert.mock.lastCall?.[0].workspaceName).toBe('Unknown workspace');
    const before = upsert.mock.calls.length;
    configuredWorkspaceRoot.set('/ws/arrived');
    TestBed.tick();
    expect(upsert).toHaveBeenCalledTimes(before + 1);
    expect(upsert.mock.lastCall?.[0]).toMatchObject({ workspacePath: '', workspaceName: 'arrived' });
    TestBed.tick();
    expect(upsert).toHaveBeenCalledTimes(before + 1);
  });

  it('keeps ordinary slash and security-word titles but drops paths and keys', () => {
    TestBed.inject(ChatAttentionSourceService);
    const request: PermissionRequest = { id: 'safe-title', toolName: 'Read', toolInput: {}, timestamp: 1,
      timeoutAt: 0, description: '', tabId: 'tab-1', sessionId: 'session-1' };
    tabs.set([{ ...tabs()[0], title: 'Fix token refresh and/or CI/CD pipeline' }]);
    permissions.set([request]);
    TestBed.tick();
    expect(upsert.mock.lastCall?.[0].context).toContain('Fix token refresh and/or CI/CD pipeline');
    for (const title of ['Use /compact', 'run /clear', '/init', '/review']) {
      tabs.set([{ ...tabs()[0], title }]);
      TestBed.tick();
      expect(upsert.mock.lastCall?.[0].context).toContain(title);
    }
    for (const title of ['/home/user/private', '/etc', '/tmp', '~/projects/x', 'src/app/foo.ts',
      'C:\\Users\\private', '\\\\server\\share\\private', ['sk-', '1234567890abcdef'].join(''),
      ['AKIA', 'ABCDEFGHIJKLMNOP'].join(''), ['ghp_', 'abcdef123456'].join(''), ['xoxb-', '1234-abcdef'].join(''),
      '0123456789abcdef0123456789abcdef']) {
      tabs.set([{ ...tabs()[0], title }]);
      TestBed.tick();
      expect(upsert.mock.lastCall?.[0].context).toBe('Claude · Tool: Read');
    }
  });

  it('drops unsafe question context but keeps ordinary slash words', () => {
    TestBed.inject(ChatAttentionSourceService);
    const request: AskUserQuestionRequest = { id: 'safe-question', toolName: 'AskUserQuestion',
      questions: [{ question: 'CI/CD pipeline and/or release?', header: 'Choice', options: [], multiSelect: false }],
      timestamp: 1, timeoutAt: 0, tabId: 'tab-1' };
    questions.set([request]);
    TestBed.tick();
    expect(upsert.mock.lastCall?.[0].context).toContain('CI/CD pipeline and/or release?');
    for (const question of ['Use /compact?', 'run /clear?', 'Try /init or /review?']) {
      questions.set([{ ...request, questions: [{ ...request.questions[0], question }] }]);
      TestBed.tick();
      expect(upsert.mock.lastCall?.[0].context).toContain(question);
    }
    for (const question of ['/etc', '/SYSTEM', '~/projects/x', 'src/app/foo.ts', 'AKIAABCDEFGHIJKLMNOP',
      'ghp_abcdef123456', 'xoxb-1234-abcdef']) {
      questions.set([{ ...request, questions: [{ ...request.questions[0], question }] }]);
      TestBed.tick();
      expect(upsert.mock.lastCall?.[0].context).toBe('Claude · Fix notifications');
    }
  });

  it('ignores a non-string tool name at the request boundary', () => {
    TestBed.inject(ChatAttentionSourceService);
    permissions.set([{ id: 'malformed-tool', toolName: 42 as unknown as string,
      toolInput: {}, timestamp: 1, timeoutAt: 0, description: '', tabId: 'tab-1' }]);
    expect(() => TestBed.tick()).not.toThrow();
    expect(upsert.mock.lastCall?.[0].context).toBe('Claude · Fix notifications');
  });

  it('caps the complete provider, title, and tool context at 80 characters', () => {
    TestBed.inject(ChatAttentionSourceService);
    tabs.set([{ ...tabs()[0], title: 'Long safe session title '.repeat(4) }]);
    permissions.set([{ id: 'long-context', toolName: 'Bash', toolInput: {}, timestamp: 1,
      timeoutAt: 0, description: '', tabId: 'tab-1' }]);
    TestBed.tick();
    const context = upsert.mock.lastCall?.[0].context;
    expect(context).toHaveLength(80);
    expect(context).toMatch(/^Claude · .*… · Tool: Bash$/);
  });

  it('omits a lane permission default session title', () => {
    TestBed.inject(ChatAttentionSourceService);
    tabs.set([{ ...tabs()[0], title: 'Lane permission required' }]);
    lanes.set([{ agentId: 'agent', parentSessionId: 'session-1', permissionQueue: [
      { requestId: 'default-lane', toolName: 'Bash', timestamp: 1 },
    ] }]);
    TestBed.tick();
    expect(upsert.mock.lastCall?.[0].context).toBe('Claude · Tool: Bash');
  });

  it('resolves a lane permission by session in an unpartitioned tab set', () => {
    ownerWorkspacePath = null;
    activeWorkspacePath.set(null);
    configuredWorkspaceRoot.set('/ws/electron');
    TestBed.inject(ChatAttentionSourceService);
    lanes.set([{ agentId: 'agent', parentSessionId: 'session-1', permissionQueue: [
      { requestId: 'lane-unpartitioned', toolName: 'Bash', timestamp: 1 },
    ] }]);
    TestBed.tick();
    expect(upsert.mock.lastCall?.[0]).toMatchObject({
      workspacePath: '', workspaceName: 'electron', tabId: 'tab-1',
      context: 'Claude · Fix notifications · Tool: Bash',
    });
  });

  it('keeps an unmatched request countable with Open disabled', () => {
    activeWorkspacePath.set(null);
    TestBed.inject(ChatAttentionSourceService);
    permissions.set([{ id: 'orphan', toolName: '', toolInput: {}, timestamp: 1,
      timeoutAt: 0, description: '', sessionId: 'missing' }]);
    TestBed.tick();
    const item = upsert.mock.lastCall?.[0];
    expect(item?.workspacePath).toBe('');
    expect(item?.actions.find(action => action.id === 'open')?.disabledReason).toBe('Session unavailable');
    expect(item?.actions.find(action => action.id === 'open')?.label).toBe('Show in canvas');
  });

  it('enables Open for a tab-less request owned by a surface', () => {
    TestBed.inject(ChatAttentionSourceService);
    permissions.set([{ id: 'surface-request', toolName: 'Read', toolInput: {}, timestamp: 1,
      timeoutAt: 0, description: '', sessionId: 'apps-session' }]);
    TestBed.tick();
    expect(upsert.mock.lastCall?.[0]).toMatchObject({
      ownerSurface: 'surface', sessionId: 'apps-session',
      actions: expect.arrayContaining([{ id: 'open', label: 'Open' }]),
    });
  });

  it('keeps an ownerless request in the real model without a reactive write loop', () => {
    TestBed.overrideProvider(NotificationService, { useClass: NotificationService });
    const model = TestBed.inject(NotificationService);
    TestBed.inject(ChatAttentionSourceService);
    permissions.set([{ id: 'ownerless', toolName: 'Write', toolInput: {}, timestamp: 1,
      timeoutAt: 0, description: '', tabId: 'missing-tab', sessionId: 'missing-session' }]);
    TestBed.tick();
    expect(model.badgeCount()).toBe(1);
    expect(model.needsYou()[0].actions.find(action => action.id === 'open')?.disabledReason).toBeTruthy();
    const original = model.needsYou()[0];
    const upsertSpy = jest.spyOn(model, 'upsert');
    tabs.set([...tabs()]);
    TestBed.tick();
    expect(upsertSpy).not.toHaveBeenCalled();
    expect(model.needsYou()[0]).toBe(original);
    expect(model.badgeCount()).toBe(1);
    permissions.set([]);
    TestBed.tick();
    expect(model.badgeCount()).toBe(0);
  });

  it('updates inline snackbar suppression when focus changes', () => {
    const focused = jest.spyOn(document, 'hasFocus').mockReturnValue(true);
    TestBed.overrideProvider(NotificationService, { useClass: NotificationService });
    const model = TestBed.inject(NotificationService);
    TestBed.inject(ChatAttentionSourceService);
    permissions.set([{ id: 'focused', toolName: 'Read', toolInput: {}, timestamp: 1,
      timeoutAt: 0, description: '', tabId: 'tab-1', sessionId: 'session-1' }]);
    TestBed.tick();
    expect(model.snackbars()).toHaveLength(0);
    focused.mockReturnValue(false);
    window.dispatchEvent(new Event('blur'));
    expect(model.snackbars()).toHaveLength(1);
    focused.mockRestore();
  });
});

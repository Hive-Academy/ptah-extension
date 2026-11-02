import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  ClaudeRpcService,
  ProvidersSettingsStateService,
  RpcResult,
  VSCodeService,
} from '@ptah-extension/core';
import type {
  AgentGetClaudeBuiltinsResult,
  AgentSetClaudeBuiltinParams,
  AgentSetClaudeBuiltinResult,
} from '@ptah-extension/shared';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
import { isDisabledControl } from '../feedback/busy-disabled.testing';
import {
  ClaudeBuiltinsConfigComponent,
  CLAUDE_BUILTINS_POLICY_UNVERIFIED,
  COULD_NOT_LOAD_CLAUDE_BUILTINS,
  COULD_NOT_UPDATE_CLAUDE_BUILTINS,
  formatApproxTokens,
} from './claude-builtins-config.component';

type Responder = () => RpcResult<unknown> | Promise<RpcResult<unknown>>;

const ok = <T>(data: T) => new RpcResult<T>(true, data);
const fail = (message: string) => new RpcResult<unknown>(false, undefined, message);

/** The shape of the backend catalog (`claude-builtin-catalog.ts`): ids, costs and the tool-to-skill map. */
function catalog(overrides: Partial<AgentGetClaudeBuiltinsResult> = {}): AgentGetClaudeBuiltinsResult {
  return {
    tools: [
      { id: 'Workflow', description: 'Launches a saved multi-step workflow script.', approxTokens: 2000, skillsNeedingIt: ['workflow-authoring'] },
      { id: 'ReportFindings', description: 'Sends code-review findings as a typed list.', approxTokens: 850, skillsNeedingIt: ['code-review'] },
      { id: 'PushNotification', description: 'Sends a desktop notification.', approxTokens: 10, skillsNeedingIt: [] },
      { id: 'DesignSync', description: 'Syncs claude.ai design files.', approxTokens: 10, skillsNeedingIt: [] },
      { id: 'EnterWorktree', description: 'Moves the session into a git worktree.', approxTokens: 10, skillsNeedingIt: [] },
      { id: 'ExitWorktree', description: 'Leaves a worktree session.', approxTokens: 10, skillsNeedingIt: [] },
    ],
    terminalSkills: [
      { id: 'keybindings-help', description: "Edits the terminal's keyboard bindings.", approxTokens: 90 },
      { id: 'update-config', description: "Edits Claude Code's settings.json hooks and permissions.", approxTokens: 270 },
      { id: 'fewer-permission-prompts', description: 'Mines CLI transcripts for a permission allowlist.', approxTokens: 70 },
      { id: 'plugin-authoring', description: 'Builds mods for the Claude terminal UI.', approxTokens: 100 },
      { id: 'init', description: 'Writes a CLAUDE.md for the project.', approxTokens: 25 },
      { id: 'workflow-authoring', description: 'Writes scripts for the Workflow tool.', approxTokens: 95, needsTool: 'Workflow' },
      { id: 'code-review', description: 'Reviews the current diff for bugs.', approxTokens: 460, needsTool: 'ReportFindings' },
    ],
    syncedSkills: [],
    enabledTools: [],
    enabledSkills: [],
    policyStatus: 'verified',
    ...overrides,
  };
}

describe('ClaudeBuiltinsConfigComponent', () => {
  let fixture: ComponentFixture<ClaudeBuiltinsConfigComponent>;
  let component: ClaudeBuiltinsConfigComponent;
  let feedback: SettingsSaveFeedbackService;
  let element: HTMLElement;
  let responses: Record<string, Responder>;
  /** The persisted lists the default responders read and change, like the backend's file settings. */
  let stored: { tools: string[]; skills: string[] };
  let lastSetItem: AgentSetClaudeBuiltinParams | undefined;
  const call = jest.fn();
  const callsOf = (method: string) => call.mock.calls.filter(([name]) => name === method);
  const SET = 'agent:setClaudeBuiltin';

  beforeEach(() => {
    stored = { tools: [], skills: [] };
    responses = {
      'agent:getClaudeBuiltins': () => ok(catalog({ enabledTools: [...stored.tools], enabledSkills: [...stored.skills] })),
      // Like the backend's atomic per-item update: only the named id changes in the stored list.
      'agent:setClaudeBuiltin': () => {
        if (!lastSetItem) throw new Error('missing params');
        const { kind, id, enabled } = lastSetItem;
        const key = kind === 'tool' ? 'tools' : 'skills';
        const without = stored[key].filter((item) => item !== id);
        stored[key] = enabled ? [...without, id] : without;
        return ok<AgentSetClaudeBuiltinResult>({
          success: true,
          enabledTools: [...stored.tools],
          enabledSkills: [...stored.skills],
        });
      },
    };
    call.mockReset();
    call.mockImplementation(async (method: string, params: unknown) => {
      const respond = responses[method];
      if (!respond) throw new Error(`unexpected RPC ${method}`);
      if (method === 'agent:setClaudeBuiltin') lastSetItem = params as AgentSetClaudeBuiltinParams;
      return respond();
    });
  });

  afterEach(() => {
    feedback?.dismiss();
    fixture?.destroy();
    TestBed.resetTestingModule();
  });

  async function settle(): Promise<void> {
    for (let pass = 0; pass < 3; pass += 1) {
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
      fixture.detectChanges();
    }
  }

  async function render(): Promise<void> {
    TestBed.configureTestingModule({
      imports: [ClaudeBuiltinsConfigComponent],
      providers: [
        { provide: ClaudeRpcService, useValue: { call } },
        { provide: ProvidersSettingsStateService, useValue: { commit: signal({ status: 'idle' }) } },
        { provide: VSCodeService, useValue: { isElectron: true, config: signal({}) } },
        SettingsSaveFeedbackService,
      ],
    });
    await TestBed.compileComponents();
    fixture = TestBed.createComponent(ClaudeBuiltinsConfigComponent);
    component = fixture.componentInstance;
    element = fixture.nativeElement as HTMLElement;
    feedback = TestBed.inject(SettingsSaveFeedbackService);
    fixture.detectChanges();
    await fixture.whenStable();
    await settle();
  }

  const byTestId = <T extends HTMLElement = HTMLElement>(id: string): T => {
    const el = element.querySelector<T>(`[data-testid="${id}"]`);
    if (!el) throw new Error(`missing [data-testid="${id}"]`);
    return el;
  };
  const queryTestId = (id: string) => element.querySelector(`[data-testid="${id}"]`);
  const toolBox = (id: string) => byTestId<HTMLInputElement>(`settings-toggle-claude-tool-${id}`);
  const skillBox = (id: string) => byTestId<HTMLInputElement>(`settings-toggle-claude-skill-${id}`);
  const savings = () => byTestId('claude-tools-savings').textContent?.replace(/\s+/g, ' ').trim();

  describe('formatApproxTokens', () => {
    it.each([
      [2000, '~2,000'],
      [850, '~850'],
      [1449, '~1,400'],
      [95, '~95'],
      [10, '~10'],
      [7, '~7'],
    ])('shows %d as %s (at most two significant digits)', (tokens, label) => {
      expect(formatApproxTokens(tokens)).toBe(label);
    });
  });

  describe('Load', () => {
    it('renders groups 1 and 2 from the catalog, unchecked by default, with costs and the applies note', async () => {
      await render();
      expect(
        element.querySelector('section')?.getAttribute('data-glass-surface'),
      ).toBe('content');

      expect(call).toHaveBeenCalledWith('agent:getClaudeBuiltins', {});
      expect(element.querySelectorAll('[data-testid^="settings-toggle-claude-tool-"]')).toHaveLength(6);
      expect(element.querySelectorAll('[data-testid^="settings-toggle-claude-skill-"]')).toHaveLength(7);
      expect(toolBox('Workflow').checked).toBe(false);
      expect(toolBox('Workflow').getAttribute('aria-label')).toBe('Workflow tool');
      expect(skillBox('code-review').getAttribute('aria-label')).toBe('code-review skill');
      expect(element.textContent).toContain('Built-in tools (off by default)');
      expect(element.textContent).toContain('Terminal-only built-in skills (off by default)');
      expect(element.textContent).toContain('Skills synced from your claude.ai account (hidden by default)');
      expect(element.textContent).toContain('~2,000');
      expect(element.textContent).toContain('~850');
      expect(byTestId('claude-tools-applies-note').getAttribute('role')).toBe('note');
      expect(byTestId('claude-tools-applies-note').textContent).toContain('These settings apply to all your workspaces.');
      // Everything off: 2,890 (tools) + 1,110 (skills) = 4,000.
      expect(savings()).toBe('Currently hidden: about 4,000 tokens per new session (estimate).');
      expect(byTestId('claude-tools-savings').getAttribute('aria-live')).toBe('polite');
      for (const table of Array.from(element.querySelectorAll('table'))) {
        const heading = element.querySelector(`#${table.getAttribute('aria-labelledby')}`);
        expect(heading?.tagName).toBe('H3');
      }
    });

    it('checks the stored opt-ins and rounds the live savings to 100', async () => {
      stored = { tools: ['ReportFindings'], skills: ['code-review'] };
      await render();

      expect(toolBox('ReportFindings').checked).toBe(true);
      expect(skillBox('code-review').checked).toBe(true);
      // 4,000 - 850 - 460 = 2,690 -> 2,700.
      expect(savings()).toBe('Currently hidden: about 2,700 tokens per new session (estimate).');
    });

    it('shows skeleton rows and an aria-busy card while loading, with no live toggles', async () => {
      let resolve: (value: RpcResult<unknown>) => void = () => undefined;
      responses['agent:getClaudeBuiltins'] = () => new Promise((r) => { resolve = r; });
      await render();

      expect(element.querySelector('section')?.getAttribute('aria-busy')).toBe('true');
      expect(element.querySelectorAll('[data-testid="claude-tools-skeleton-row"]')).toHaveLength(9);
      expect(queryTestId('claude-tools-synced-empty')).toBeNull();
      expect(element.querySelector('[data-testid^="settings-toggle-claude-"]')).toBeNull();
      expect(element.textContent).toContain('Built-in tools (off by default)');

      resolve(ok(catalog()));
      await settle();
      expect(element.querySelector('section')?.getAttribute('aria-busy')).toBeNull();
      expect(queryTestId('claude-tools-skeleton-row')).toBeNull();
    });

    it.each<[string, Responder]>([
      ['an RPC failure', () => fail('host detail: load failed')],
      ['a throw', () => { throw new Error('host detail: socket'); }],
    ])('%s shows the fixed load error with Retry and no toggles; Retry reloads', async (_, respond) => {
      responses['agent:getClaudeBuiltins'] = respond;
      await render();

      const alert = byTestId('claude-tools-load-error');
      expect(alert.getAttribute('role')).toBe('alert');
      expect(alert.textContent).toContain(COULD_NOT_LOAD_CLAUDE_BUILTINS);
      expect(element.textContent).not.toContain('host detail');
      expect(element.querySelector('[data-testid^="settings-toggle-claude-"]')).toBeNull();
      expect(queryTestId('claude-tools-savings')).toBeNull();

      responses['agent:getClaudeBuiltins'] = () => ok(catalog());
      byTestId<HTMLButtonElement>('claude-tools-load-retry').click();
      await settle();
      expect(queryTestId('claude-tools-load-error')).toBeNull();
      expect(toolBox('Workflow')).toBeTruthy();
    });

    it('fails closed on an unverified capability policy: error block, no toggles, no defaults', async () => {
      responses['agent:getClaudeBuiltins'] = () => ok(catalog({ policyStatus: 'unverified', enabledTools: ['Workflow'] }));
      await render();

      expect(byTestId('claude-tools-load-error').textContent).toContain(CLAUDE_BUILTINS_POLICY_UNVERIFIED);
      expect(element.querySelector('[data-testid^="settings-toggle-claude-"]')).toBeNull();
      await component.toggle('tool', 'Workflow');
      expect(callsOf('agent:setClaudeBuiltin')).toEqual([]);
    });
  });

  describe('Group 3: skills synced from the claude.ai account', () => {
    const SYNCED = [
      { id: 'anthropic-skills:docx', name: 'docx', description: 'Creates and edits Word documents.', approxTokens: 120 },
      { id: 'anthropic-skills:init', name: 'init', description: 'Account copy of a skill named init.', approxTokens: 80 },
    ];
    const syncedTable = () => element.querySelector('table[aria-labelledby="claude-tools-group-synced-skills"]');
    const withSynced = () =>
      ok(catalog({ syncedSkills: SYNCED, enabledTools: [...stored.tools], enabledSkills: [...stored.skills] }));

    it('lists each synced skill by name, unchecked, with its cost and a qualified toggle id', async () => {
      responses['agent:getClaudeBuiltins'] = withSynced;
      await render();

      const docx = skillBox('anthropic-skills:docx');
      expect(docx.checked).toBe(false);
      expect(docx.getAttribute('aria-label')).toBe('docx skill');
      expect(syncedTable()?.querySelectorAll('tbody tr')).toHaveLength(2);
      expect(Array.from(syncedTable()?.querySelectorAll('th') ?? []).map((th) => th.textContent?.trim())).toEqual([
        'On',
        'Skill',
        'Token cost',
        'Description',
      ]);
      expect(syncedTable()?.textContent).toContain('Creates and edits Word documents.');
      expect(syncedTable()?.textContent).toContain('~120');
      expect(syncedTable()?.textContent).not.toContain('anthropic-skills:');
      expect(queryTestId('claude-tools-synced-empty')).toBeNull();
      // Groups 1-3 all off: 4,000 + 120 + 80 = 4,200.
      expect(savings()).toBe('Currently hidden: about 4,200 tokens per new session (estimate).');
    });

    it('shows the empty state, and no group 3 table, when the account has no synced skills', async () => {
      await render();

      const empty = byTestId('claude-tools-synced-empty');
      expect(empty.textContent).toContain('No claude.ai skills found');
      expect(empty.textContent).toContain('If you sync skills from your claude.ai account, they will be listed here.');
      expect(syncedTable()).toBeNull();
      expect(element.textContent).toContain('Skills synced from your claude.ai account (hidden by default)');
    });

    it('checks a stored synced opt-in apart from the terminal skill of the same name', async () => {
      stored.skills = ['anthropic-skills:init'];
      responses['agent:getClaudeBuiltins'] = withSynced;
      await render();

      expect(skillBox('anthropic-skills:init').checked).toBe(true);
      expect(skillBox('init').checked).toBe(false);
      // 4,200 - 80 = 4,120 -> 4,100.
      expect(savings()).toBe('Currently hidden: about 4,100 tokens per new session (estimate).');
    });

    it('sends the qualified id, toasts the plain name, sums the savings live, and Undo sends the inverse call', async () => {
      responses['agent:getClaudeBuiltins'] = withSynced;
      await render();

      skillBox('anthropic-skills:docx').click();
      await settle();

      expect(callsOf(SET)).toEqual([[SET, { kind: 'skill', id: 'anthropic-skills:docx', enabled: true }]]);
      expect(skillBox('anthropic-skills:docx').checked).toBe(true);
      expect(skillBox('init').checked).toBe(false);
      expect(feedback.toast()?.message).toBe('Saved docx skill.');
      // 4,200 - 120 = 4,080 -> 4,100.
      expect(savings()).toBe('Currently hidden: about 4,100 tokens per new session (estimate).');

      await feedback.undo();
      await settle();

      expect(call).toHaveBeenLastCalledWith(SET, { kind: 'skill', id: 'anthropic-skills:docx', enabled: false });
      expect(skillBox('anthropic-skills:docx').checked).toBe(false);
      expect(savings()).toBe('Currently hidden: about 4,200 tokens per new session (estimate).');
    });

    it('a failed synced save re-reads the stored lists, shows the fixed error and keeps focus', async () => {
      responses['agent:getClaudeBuiltins'] = withSynced;
      responses[SET] = () => fail('host detail: EACCES');
      await render();

      const box = skillBox('anthropic-skills:docx');
      box.focus();
      box.click();
      await settle();

      expect(feedback.toast()?.message).toBe(COULD_NOT_UPDATE_CLAUDE_BUILTINS);
      expect(element.textContent).not.toContain('host detail');
      expect(skillBox('anthropic-skills:docx').checked).toBe(false);
      expect(document.activeElement).toBe(skillBox('anthropic-skills:docx'));
    });

    it('marks group 3 toggles busy while a save runs', async () => {
      let resolve: (value: RpcResult<unknown>) => void = () => undefined;
      responses['agent:getClaudeBuiltins'] = withSynced;
      responses[SET] = () => new Promise((r) => { resolve = r; });
      await render();

      toolBox('Workflow').click();
      await settle();
      expect(isDisabledControl(skillBox('anthropic-skills:docx'))).toBe(true);

      resolve(ok({ success: true, enabledTools: ['Workflow'], enabledSkills: [] }));
      await settle();
      expect(isDisabledControl(skillBox('anthropic-skills:docx'))).toBe(false);
    });

    it('shows skeleton rows in group 3 while loading', async () => {
      let resolve: (value: RpcResult<unknown>) => void = () => undefined;
      responses['agent:getClaudeBuiltins'] = () => new Promise((r) => { resolve = r; });
      await render();

      expect(syncedTable()?.querySelectorAll('[data-testid="claude-tools-skeleton-row"]')).toHaveLength(3);

      resolve(withSynced());
      await settle();
      expect(skillBox('anthropic-skills:docx')).toBeTruthy();
    });

    it('fails closed on an unverified policy: no synced rows, no empty state, no toggles', async () => {
      responses['agent:getClaudeBuiltins'] = () => ok(catalog({ syncedSkills: SYNCED, policyStatus: 'unverified' }));
      await render();

      expect(byTestId('claude-tools-load-error').textContent).toContain(CLAUDE_BUILTINS_POLICY_UNVERIFIED);
      expect(queryTestId('settings-toggle-claude-skill-anthropic-skills:docx')).toBeNull();
      expect(queryTestId('claude-tools-synced-empty')).toBeNull();
      expect(element.textContent).not.toContain('Skills synced from your claude.ai account');
    });
  });

  describe('Toggle, save and Undo', () => {
    it('sends one per-item call, toasts, updates the savings live, and Undo sends the inverse call', async () => {
      await render();

      toolBox('Workflow').click();
      await settle();

      expect(call).toHaveBeenCalledWith(SET, { kind: 'tool', id: 'Workflow', enabled: true });
      expect(toolBox('Workflow').checked).toBe(true);
      expect(savings()).toBe('Currently hidden: about 2,000 tokens per new session (estimate).');
      expect(feedback.toast()?.tone).toBe('status');
      expect(feedback.toast()?.message).toBe('Saved Workflow tool.');
      expect(feedback.toast()?.canUndo).toBe(true);

      await feedback.undo();
      await settle();

      expect(call).toHaveBeenLastCalledWith(SET, { kind: 'tool', id: 'Workflow', enabled: false });
      expect(toolBox('Workflow').checked).toBe(false);
      expect(savings()).toBe('Currently hidden: about 4,000 tokens per new session (estimate).');
    });

    it('sends only the skill id, never a list, so stored ids this card does not show are untouched', async () => {
      stored.skills = ['anthropic-skills:docs'];
      await render();

      skillBox('init').click();
      await settle();

      expect(callsOf('agent:setClaudeBuiltin')).toEqual([[SET, { kind: 'skill', id: 'init', enabled: true }]]);
      expect(callsOf('agent:setConfig')).toEqual([]);
      expect(stored.skills).toEqual(['anthropic-skills:docs', 'init']);
      expect(feedback.toast()?.message).toBe('Saved init skill.');
    });

    it('Undo restores only its own item, keeping a later toggle', async () => {
      await render();

      toolBox('Workflow').click();
      await settle();
      feedback.dismiss();
      toolBox('PushNotification').click();
      await settle();
      await feedback.undo();
      await settle();

      expect(call).toHaveBeenLastCalledWith(SET, { kind: 'tool', id: 'PushNotification', enabled: false });
      expect(toolBox('Workflow').checked).toBe(true);
      expect(toolBox('PushNotification').checked).toBe(false);
    });

    it.each<[string, Responder]>([
      ['a refused write', () => fail('host detail: write refused')],
      ['a throw', () => { throw new Error('host detail: socket'); }],
      ['an uncertain success without lists', () => ok({ success: true })],
    ])('%s re-reads, reverts the checkbox, keeps focus on it and toasts the fixed sentence', async (_, respond) => {
      responses['agent:setClaudeBuiltin'] = respond;
      await render();

      const box = skillBox('code-review');
      box.focus();
      box.click();
      await settle();

      expect(box.checked).toBe(false);
      expect(component.isSkillOn('code-review')).toBe(false);
      expect(document.activeElement).toBe(skillBox('code-review'));
      expect(feedback.toast()?.tone).toBe('alert');
      expect(feedback.toast()?.message).toBe(COULD_NOT_UPDATE_CLAUDE_BUILTINS);
      expect(feedback.toast()?.message).not.toContain('host detail');
      expect(savings()).toBe('Currently hidden: about 4,000 tokens per new session (estimate).');
    });

    it('marks every toggle busy (still focusable) while a save runs', async () => {
      let resolve: (value: RpcResult<unknown>) => void = () => undefined;
      responses['agent:setClaudeBuiltin'] = () => new Promise((r) => { resolve = r; });
      await render();

      const box = toolBox('Workflow');
      box.focus();
      box.click();
      await settle();

      expect(isDisabledControl(toolBox('ReportFindings'))).toBe(true);
      expect(toolBox('ReportFindings').disabled).toBe(false);
      expect(document.activeElement).toBe(box);

      resolve(ok({ success: true, enabledTools: ['Workflow'], enabledSkills: [] }));
      await settle();
      expect(isDisabledControl(toolBox('ReportFindings'))).toBe(false);
    });
  });

  describe('Dependency blocked', () => {
    it('badges a skill that is on while its tool is off; turning the tool on clears it and never changes the skill', async () => {
      stored.skills = ['code-review'];
      await render();

      const badge = byTestId('claude-skill-dependency-code-review');
      expect(badge.textContent?.trim()).toBe('ReportFindings tool is off');
      expect(badge.classList).toContain('badge-warning');
      const describedBy = skillBox('code-review').getAttribute('aria-describedby');
      expect(element.querySelector(`#${describedBy}`)?.textContent?.trim()).toBe(
        'This skill is on but unavailable until the ReportFindings tool is on.',
      );
      // A default-off skill whose tool is also off is not "blocked": it is simply off.
      expect(queryTestId('claude-skill-dependency-workflow-authoring')).toBeNull();

      toolBox('ReportFindings').click();
      await settle();

      expect(queryTestId('claude-skill-dependency-code-review')).toBeNull();
      expect(skillBox('code-review').getAttribute('aria-describedby')).toBeNull();
      expect(skillBox('code-review').checked).toBe(true);
      expect(skillBox('workflow-authoring').checked).toBe(false);
      expect(callsOf('agent:setClaudeBuiltin')).toEqual([[SET, { kind: 'tool', id: 'ReportFindings', enabled: true }]]);
    });

    it('still counts a dependency-blocked skill as hidden; turning its tool on lowers the total by both costs', async () => {
      await render();

      skillBox('code-review').click();
      await settle();
      expect(skillBox('code-review').checked).toBe(true);
      // The backend still denies code-review while ReportFindings is off: the total stays 4,000.
      expect(savings()).toBe('Currently hidden: about 4,000 tokens per new session (estimate).');

      feedback.dismiss();
      toolBox('ReportFindings').click();
      await settle();
      // 4,000 - 850 - 460 = 2,690 -> 2,700.
      expect(savings()).toBe('Currently hidden: about 2,700 tokens per new session (estimate).');
    });
  });

  describe('Atomic per-item write (another writer)', () => {
    it('writes without a fresh read and shows the lists the call returns, including another writer\'s opt-in', async () => {
      await render();
      const readsBefore = callsOf('agent:getClaudeBuiltins').length;

      // Another window or `ptah agent config-set` turns Workflow on after this card loaded.
      stored.tools = ['Workflow'];
      toolBox('ReportFindings').click();
      await settle();

      expect(callsOf('agent:getClaudeBuiltins').length).toBe(readsBefore);
      expect(callsOf('agent:setClaudeBuiltin')).toEqual([[SET, { kind: 'tool', id: 'ReportFindings', enabled: true }]]);
      expect(callsOf('agent:setConfig')).toEqual([]);
      expect(stored.tools).toEqual(['Workflow', 'ReportFindings']);
      expect(toolBox('Workflow').checked).toBe(true);
      expect(toolBox('ReportFindings').checked).toBe(true);
    });

    it('takes both lists from the response, not from a local delta', async () => {
      stored.skills = ['init'];
      await render();

      responses['agent:setClaudeBuiltin'] = () =>
        ok<AgentSetClaudeBuiltinResult>({ success: true, enabledTools: ['DesignSync'], enabledSkills: ['update-config'] });
      skillBox('init').click();
      await settle();

      expect(component.enabledTools()).toEqual(['DesignSync']);
      expect(component.enabledSkills()).toEqual(['update-config']);
      expect(skillBox('init').checked).toBe(false);
      expect(skillBox('update-config').checked).toBe(true);
      expect(toolBox('DesignSync').checked).toBe(true);
    });

    it('Undo sends the inverse per-item call without a read and shows its returned lists', async () => {
      await render();

      toolBox('Workflow').click();
      await settle();
      stored.tools = [...stored.tools, 'DesignSync'];
      const readsBefore = callsOf('agent:getClaudeBuiltins').length;
      await feedback.undo();
      await settle();

      expect(callsOf('agent:getClaudeBuiltins').length).toBe(readsBefore);
      expect(call).toHaveBeenLastCalledWith(SET, { kind: 'tool', id: 'Workflow', enabled: false });
      expect(toolBox('Workflow').checked).toBe(false);
      expect(toolBox('DesignSync').checked).toBe(true);
    });

    it('a failed write re-reads the stored lists and shows them, not a local revert', async () => {
      responses['agent:setClaudeBuiltin'] = () => fail('host detail: write refused');
      await render();
      const readsBefore = callsOf('agent:getClaudeBuiltins').length;

      // The write fails, but the reload shows what is really stored now.
      stored.tools = ['PushNotification'];
      const box = toolBox('Workflow');
      box.focus();
      box.click();
      await settle();

      // Only the recovery read after the failed write.
      expect(callsOf('agent:getClaudeBuiltins').length).toBe(readsBefore + 1);
      expect(toolBox('Workflow').checked).toBe(false);
      expect(toolBox('PushNotification').checked).toBe(true);
      expect(component.enabledTools()).toEqual(['PushNotification']);
      expect(document.activeElement).toBe(toolBox('Workflow'));
      expect(feedback.toast()?.message).toBe(COULD_NOT_UPDATE_CLAUDE_BUILTINS);
    });

    it('a failed write whose recovery read also fails shows the load error with Retry, focused', async () => {
      responses['agent:setClaudeBuiltin'] = () => { throw new Error('host detail: socket'); };
      await render();

      responses['agent:getClaudeBuiltins'] = () => fail('host detail: load failed');
      const box = toolBox('Workflow');
      box.focus();
      box.click();
      await settle();

      expect(byTestId('claude-tools-load-error').textContent).toContain(COULD_NOT_LOAD_CLAUDE_BUILTINS);
      expect(element.querySelector('[data-testid^="settings-toggle-claude-"]')).toBeNull();
      expect(document.activeElement).toBe(byTestId('claude-tools-load-retry'));
      expect(element.textContent).not.toContain('host detail');
    });

    it('serializes two quick toggles: the second is refused while the first save runs, then sends its own call', async () => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((r) => { release = r; });
      const persist = responses['agent:setClaudeBuiltin'];
      responses['agent:setClaudeBuiltin'] = async () => { await gate; return persist(); };
      await render();

      const first = component.toggle('tool', 'Workflow');
      const second = component.toggle('tool', 'ReportFindings');
      await second;
      expect(component.isToolOn('ReportFindings')).toBe(false);
      release();
      await first;
      await settle();

      expect(callsOf('agent:setClaudeBuiltin')).toEqual([[SET, { kind: 'tool', id: 'Workflow', enabled: true }]]);
      expect(stored.tools).toEqual(['Workflow']);

      feedback.dismiss();
      responses['agent:setClaudeBuiltin'] = persist;
      await component.toggle('tool', 'ReportFindings');
      await settle();
      expect(call).toHaveBeenLastCalledWith(SET, { kind: 'tool', id: 'ReportFindings', enabled: true });
      expect(toolBox('Workflow').checked).toBe(true);
      expect(toolBox('ReportFindings').checked).toBe(true);
    });
  });
});

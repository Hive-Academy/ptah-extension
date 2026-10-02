/**
 * SessionOrganizationEditorComponent specs (TASK_2026_580 C1.1.3).
 *
 * Coverage: each mutation RPC with its params, a successful result replacing
 * the dialog's record, `ok: false` and transport failures rendered inline,
 * the `https:`-only PR rule (input and stored links), and "Open worktree"
 * through `editor:openWorkspace` with "Copy path" beside it (Assumption A3).
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import {
  SESSION_ORGANIZATION_DEFAULTS,
  type ChatSessionSummary,
  type SessionId,
  type SessionOrganizationSummary,
} from '@ptah-extension/shared';
import {
  SessionOrganizationEditorComponent,
  httpsUrlOrNull,
} from './session-organization-editor.component';

const SESSION_ID = 'a1b2c3d4-0000-4000-8000-000000000002';

function organization(
  overrides: Partial<SessionOrganizationSummary> = {},
): SessionOrganizationSummary {
  return {
    ...SESSION_ORGANIZATION_DEFAULTS,
    worktreePath: null,
    branch: null,
    parentSessionId: null,
    forkOfSessionId: null,
    tasks: [],
    prLinks: [],
    childCount: 0,
    updatedAt: null,
    ...overrides,
  };
}

function row(org: SessionOrganizationSummary): ChatSessionSummary {
  return {
    id: SESSION_ID as SessionId,
    name: 'Refactor loader',
    messageCount: 3,
    createdAt: 1,
    lastActivityAt: 2,
    isActive: false,
    organization: org,
  };
}

function ok<T>(data: T) {
  return { success: true, data, isSuccess: () => true };
}

function transportFailure(error: string) {
  return { success: false, data: undefined, error, isSuccess: () => false };
}

describe('SessionOrganizationEditorComponent', () => {
  let fixture: ComponentFixture<SessionOrganizationEditorComponent>;
  let host: HTMLElement;
  let responders: Map<string, (params: unknown) => unknown>;
  const rpc = {
    call: jest.fn((method: string, params: unknown) => {
      const respond = responders.get(method);
      return Promise.resolve(
        respond ? respond(params) : transportFailure(`No responder ${method}`),
      );
    }),
  };

  const el = <T extends HTMLElement>(testId: string): T => {
    const found = host.querySelector<T>(`[data-testid="${testId}"]`);
    if (!found) throw new Error(`Missing ${testId}`);
    return found;
  };
  const maybe = (testId: string): HTMLElement | null =>
    host.querySelector(`[data-testid="${testId}"]`);

  const settle = async (): Promise<void> => {
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const open = async (org: SessionOrganizationSummary): Promise<void> => {
    fixture.componentRef.setInput('session', row(org));
    fixture.detectChanges();
    await settle();
  };

  const mutationOk = (org: SessionOrganizationSummary) => () =>
    ok({ ok: true, organization: org });

  const callsTo = (method: string): unknown[] =>
    rpc.call.mock.calls.filter(([m]) => m === method).map(([, p]) => p);

  beforeEach(() => {
    responders = new Map();
    rpc.call.mockClear();
    TestBed.configureTestingModule({
      imports: [SessionOrganizationEditorComponent],
      providers: [{ provide: ClaudeRpcService, useValue: rpc }],
    });
    fixture = TestBed.createComponent(SessionOrganizationEditorComponent);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  it('stays closed without a session and opens as a labelled dialog', async () => {
    expect(maybe('session-organization-editor')).toBeNull();

    await open(organization());
    const dialog = el('session-organization-editor');
    const titleId = dialog.getAttribute('aria-labelledby');
    expect(titleId).toBeTruthy();
    expect(host.querySelector(`#${titleId}`)?.textContent).toContain(
      'Refactor loader',
    );
  });

  it('sends session:setOrganization for priority, status and pin', async () => {
    responders.set(
      'session:setOrganization',
      mutationOk(organization({ priority: 'urgent' })),
    );
    await open(organization());

    const priority = el<HTMLSelectElement>('session-org-priority');
    priority.value = 'urgent';
    priority.dispatchEvent(new Event('change'));
    await settle();

    const status = el<HTMLSelectElement>('session-org-status');
    status.value = 'done';
    status.dispatchEvent(new Event('change'));
    await settle();

    el<HTMLInputElement>('session-org-pinned').click();
    await settle();

    expect(callsTo('session:setOrganization')).toEqual([
      { sessionId: SESSION_ID, priority: 'urgent' },
      { sessionId: SESSION_ID, status: 'done' },
      { sessionId: SESSION_ID, pinned: true },
    ]);
    expect(fixture.componentInstance.organization()?.priority).toBe('urgent');
  });

  it('links a task with the chosen role and unlinks one', async () => {
    const linked = organization({
      tasks: [
        {
          taskId: 'TASK_2026_580_9f77',
          role: 'primary',
          source: 'user',
          createdAt: 1,
          missing: false,
        },
      ],
    });
    responders.set('session:linkTask', mutationOk(linked));
    responders.set('session:unlinkTask', mutationOk(organization()));
    await open(organization());

    const input = el<HTMLInputElement>('session-org-task-input');
    input.value = ' TASK_2026_580_9f77 ';
    input.dispatchEvent(new Event('input'));
    const role = el<HTMLSelectElement>('session-org-task-role');
    role.value = 'primary';
    role.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    el<HTMLFormElement>('session-org-link-form').dispatchEvent(
      new Event('submit'),
    );
    await settle();

    expect(callsTo('session:linkTask')).toEqual([
      {
        sessionId: SESSION_ID,
        taskId: 'TASK_2026_580_9f77',
        role: 'primary',
        source: 'user',
      },
    ]);
    expect(
      host.querySelectorAll('[data-testid="session-org-task"]').length,
    ).toBe(1);
    expect(el<HTMLInputElement>('session-org-task-input').value).toBe('');

    el<HTMLButtonElement>('session-org-unlink-task').click();
    await settle();
    expect(callsTo('session:unlinkTask')).toEqual([
      { sessionId: SESSION_ID, taskId: 'TASK_2026_580_9f77' },
    ]);
    expect(maybe('session-org-task')).toBeNull();
  });

  it('adds an https PR link, refuses any other scheme, and removes one', async () => {
    const pr = {
      url: 'https://github.com/o/r/pull/7',
      number: 7,
      repo: 'o/r',
      state: 'open' as const,
      source: 'user' as const,
      createdAt: 1,
    };
    responders.set(
      'session:addPrLink',
      mutationOk(organization({ prLinks: [pr] })),
    );
    responders.set('session:removePrLink', mutationOk(organization()));
    await open(organization());

    const input = el<HTMLInputElement>('session-org-pr-input');
    input.value = 'http://github.com/o/r/pull/7';
    input.dispatchEvent(new Event('input'));
    el<HTMLFormElement>('session-org-pr-form').dispatchEvent(
      new Event('submit'),
    );
    await settle();
    expect(callsTo('session:addPrLink')).toEqual([]);
    expect(el('session-org-error').textContent).toContain('https://');

    input.value = pr.url;
    input.dispatchEvent(new Event('input'));
    el<HTMLFormElement>('session-org-pr-form').dispatchEvent(
      new Event('submit'),
    );
    await settle();
    expect(callsTo('session:addPrLink')).toEqual([
      { sessionId: SESSION_ID, url: pr.url },
    ]);
    const link = el<HTMLAnchorElement>('session-org-pr-link');
    expect(link.getAttribute('href')).toBe(pr.url);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.textContent).toContain('o/r#7');

    el<HTMLButtonElement>('session-org-remove-pr').click();
    await settle();
    expect(callsTo('session:removePrLink')).toEqual([
      { sessionId: SESSION_ID, url: pr.url },
    ]);
  });

  it('renders a stored non-https PR link as text, never as a link', async () => {
    await open(
      organization({
        prLinks: [
          {
            url: 'javascript:alert(1)',
            number: null,
            repo: null,
            state: null,
            source: 'agent',
            createdAt: 1,
          },
        ],
      }),
    );
    expect(maybe('session-org-pr-link')).toBeNull();
    expect(el('session-org-pr-text').textContent).toContain(
      'javascript:alert(1)',
    );
  });

  it('shows ok:false and transport failures inline and keeps the record', async () => {
    responders.set('session:setOrganization', () =>
      ok({
        ok: false,
        reason: 'session-not-found',
        message: 'That session no longer exists.',
      }),
    );
    await open(organization());

    const status = el<HTMLSelectElement>('session-org-status');
    status.value = 'archived';
    status.dispatchEvent(new Event('change'));
    await settle();
    const alert = el('session-org-error');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toContain('That session no longer exists.');
    expect(fixture.componentInstance.organization()?.status).toBe('active');

    responders.set('session:setOrganization', () =>
      transportFailure('RPC timeout: session:setOrganization'),
    );
    el<HTMLInputElement>('session-org-pinned').click();
    await settle();
    expect(el('session-org-error').textContent).toContain('RPC timeout');
  });

  it('opens the worktree through editor:openWorkspace and reports a refusal', async () => {
    responders.set('editor:detectTargets', () =>
      ok({
        success: true,
        targets: [{ id: 'cursor', displayName: 'Cursor' }],
      }),
    );
    responders.set('editor:openWorkspace', () =>
      ok({ success: false, error: 'Workspace root is outside the workspace' }),
    );
    await open(
      organization({ worktreePath: '/repo/.wt/feature', branch: 'feat/x' }),
    );

    expect(el('session-org-worktree-path').textContent).toContain(
      '/repo/.wt/feature',
    );
    el<HTMLButtonElement>('session-org-open-worktree').click();
    await settle();

    expect(callsTo('editor:openWorkspace')).toEqual([
      { target: 'cursor', root: '/repo/.wt/feature' },
    ]);
    const notice = el('session-org-worktree-notice');
    expect(notice.textContent).toContain('outside the workspace');
    expect(notice.textContent).toContain('Copy path');
  });

  it('copies the worktree path and falls back to copy when no editor is detected', async () => {
    const writeText = jest.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    responders.set('editor:detectTargets', () =>
      ok({ success: false, targets: [], error: 'detection failed' }),
    );
    await open(organization({ worktreePath: '/repo/.wt/a', branch: null }));

    expect(maybe('session-org-open-worktree')).toBeNull();
    el<HTMLButtonElement>('session-org-copy-path').click();
    await settle();
    expect(writeText).toHaveBeenCalledWith('/repo/.wt/a');
    expect(el('session-org-worktree-notice').textContent).toContain(
      'Path copied.',
    );
  });

  it('emits closed on Escape and from the close button', async () => {
    await open(organization());
    const closed = jest.fn();
    fixture.componentInstance.closed.subscribe(closed);

    el('session-organization-editor').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape' }),
    );
    el<HTMLButtonElement>('session-org-close').click();
    expect(closed).toHaveBeenCalledTimes(2);
  });

  it('accepts only https URLs within the length cap', () => {
    expect(httpsUrlOrNull(' https://github.com/o/r/pull/1 ')).toBe(
      'https://github.com/o/r/pull/1',
    );
    expect(httpsUrlOrNull('http://github.com/o/r/pull/1')).toBeNull();
    expect(httpsUrlOrNull('javascript:alert(1)')).toBeNull();
    expect(httpsUrlOrNull('not a url')).toBeNull();
    expect(httpsUrlOrNull(`https://x.dev/${'a'.repeat(2048)}`)).toBeNull();
  });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { GitDockScope } from '../services/git-dock-scope.store';
import { GitDockScopeHeaderComponent } from './git-dock-scope-header.component';

const FOLLOW_WORKTREE: GitDockScope = {
  mode: 'follow-session',
  root: '/repo/.worktrees/feature-x',
  source: 'organization-worktree',
  session: { tabId: 't1', name: 'Fix login', closed: false },
  isWorktree: true,
  unresolved: false,
};

const FOLLOW_TITLE = 'Following the active session · /repo/.worktrees/feature-x';
const PINNED_TITLE = 'Pinned to Fix login · /repo/.worktrees/feature-x';
const PIN_TOOLTIP =
  "Pin scope — keep the Git panel on this session's folder when you switch chat tabs. By default the panel follows the active session.";
const UNPIN_TOOLTIP =
  'Follow active session — the Git panel is pinned to Fix login. Click to follow the active chat tab again.';

describe('GitDockScopeHeaderComponent', () => {
  let fixture: ComponentFixture<GitDockScopeHeaderComponent>;
  let toggles: boolean[];

  function render(
    scope: GitDockScope,
    extra: { branch?: string | null; compact?: boolean } = {},
  ): HTMLElement {
    fixture.componentRef.setInput('scope', scope);
    if (extra.branch !== undefined) {
      fixture.componentRef.setInput('branch', extra.branch);
    }
    if (extra.compact !== undefined) {
      fixture.componentRef.setInput('compact', extra.compact);
    }
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const byTestId = (host: HTMLElement, id: string): HTMLElement | null =>
    host.querySelector(`[data-testid="${id}"]`);

  beforeEach(() => {
    toggles = [];
    TestBed.configureTestingModule({
      imports: [GitDockScopeHeaderComponent],
    });
    fixture = TestBed.createComponent(GitDockScopeHeaderComponent);
    fixture.componentInstance.pinToggled.subscribe((value) =>
      toggles.push(value),
    );
  });

  it('shows the session, worktree folder, branch and source hint', () => {
    const host = render(FOLLOW_WORKTREE, { branch: 'feature/x' });

    expect(byTestId(host, 'git-dock-scope-name')?.textContent).toContain(
      'Fix login',
    );
    expect(byTestId(host, 'git-dock-scope-folder')?.textContent).toContain(
      'feature-x',
    );
    expect(byTestId(host, 'git-dock-scope-branch')?.textContent).toContain(
      'feature/x',
    );
    expect(byTestId(host, 'git-dock-scope-hint')?.textContent).toContain(
      'session worktree',
    );
    const label = byTestId(host, 'git-dock-scope-label');
    expect(label?.getAttribute('role')).toBe('status');
    expect(label?.getAttribute('title')).toBe(FOLLOW_TITLE);
  });

  it('flags an unresolved session scope as read-only instead of naming a folder', () => {
    const host = render({
      mode: 'follow-session',
      root: null,
      source: null,
      session: { tabId: 't1', name: 'Fix login', closed: false },
      isWorktree: false,
      unresolved: true,
    });

    expect(byTestId(host, 'git-dock-scope-name')?.textContent).toContain(
      'Fix login',
    );
    expect(byTestId(host, 'git-dock-scope-folder')).toBeNull();
    expect(
      byTestId(host, 'git-dock-scope-unresolved')?.textContent,
    ).toContain('read-only');
    expect(
      byTestId(host, 'git-dock-scope-label')?.getAttribute('title'),
    ).toContain('not loaded');
  });

  it('labels the workspace scope, an agent worktree and no folder', () => {
    let host = render({
      mode: 'follow-session',
      root: '/repo',
      source: 'workspace-root',
      session: null,
      isWorktree: false,
      unresolved: false,
    });
    expect(byTestId(host, 'git-dock-scope-name')?.textContent).toContain(
      'Workspace',
    );
    expect(byTestId(host, 'git-dock-scope-hint')?.textContent).toContain(
      'workspace',
    );
    expect(
      byTestId(host, 'git-dock-scope-label')?.getAttribute('title'),
    ).toBe('Following the active session · /repo');

    host = render({ ...FOLLOW_WORKTREE, source: 'agent-origin-worktree' });
    expect(byTestId(host, 'git-dock-scope-hint')?.textContent).toContain(
      'agent worktree',
    );

    host = render({
      mode: 'follow-session',
      root: null,
      source: null,
      session: null,
      isWorktree: false,
      unresolved: false,
    });
    expect(byTestId(host, 'git-dock-scope-name')?.textContent).toContain(
      'No folder open',
    );
  });

  it('marks a closed pinned session', () => {
    const host = render({
      ...FOLLOW_WORKTREE,
      mode: 'pinned',
      session: { tabId: 't1', name: 'Fix login', closed: true },
    });

    expect(byTestId(host, 'git-dock-scope-name')?.textContent).toContain(
      'Fix login (closed)',
    );
    expect(
      byTestId(host, 'git-dock-scope-label')?.getAttribute('title'),
    ).toBe(PINNED_TITLE);
  });

  it('emits pin from follow mode and unpin from pinned mode, with aria-pressed', () => {
    let host = render(FOLLOW_WORKTREE);
    let toggle = byTestId(host, 'git-dock-scope-pin') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.getAttribute('aria-label')).toBe(PIN_TOOLTIP);
    expect(toggle.getAttribute('title')).toBe(PIN_TOOLTIP);
    expect(toggle.textContent).toContain('Pin scope');
    toggle.click();

    host = render({ ...FOLLOW_WORKTREE, mode: 'pinned' });
    toggle = byTestId(host, 'git-dock-scope-pin') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.getAttribute('aria-label')).toBe(UNPIN_TOOLTIP);
    expect(toggle.getAttribute('title')).toBe(UNPIN_TOOLTIP);
    expect(toggle.textContent).toContain('Follow active session');
    toggle.click();

    expect(toggles).toEqual([true, false]);
  });

  it('disables pinning when there is no session to pin', () => {
    const host = render({
      mode: 'follow-session',
      root: '/repo',
      source: 'workspace-root',
      session: null,
      isWorktree: false,
      unresolved: false,
    });

    expect(
      (byTestId(host, 'git-dock-scope-pin') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('keeps only the icon and its aria-label in compact mode', () => {
    const host = render(FOLLOW_WORKTREE, { compact: true });
    const toggle = byTestId(host, 'git-dock-scope-pin') as HTMLButtonElement;

    expect(toggle.textContent?.trim()).toBe('');
    expect(toggle.getAttribute('aria-label')).toBe(PIN_TOOLTIP);
    expect(byTestId(host, 'git-dock-scope-hint')).toBeNull();
  });
});

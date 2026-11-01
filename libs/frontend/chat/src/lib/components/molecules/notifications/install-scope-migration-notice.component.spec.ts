import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  AppStateManager,
  ClaudeRpcService,
  RpcResult,
} from '@ptah-extension/core';
import type { InstallMigrationNotice } from '@ptah-extension/shared';
import {
  INSTALL_MIGRATION_NOTICE_DISMISS_ERROR,
  INSTALL_MIGRATION_NOTICE_RECHECK_MS,
  InstallScopeMigrationNoticeComponent,
  type InstallScopeMigrationNoticeAction,
} from './install-scope-migration-notice.component';

const GET = 'harness:get-install-migration-notice';
const DISMISS = 'harness:dismiss-install-migration-notice';

/** Real legacy skills.sh root form (never `~/.agents/skills`). */
const SKILLS_SH_ROOT = '~/.ptah/plugins/ptah-skillssh-acme-notes';

const FULL: InstallMigrationNotice = {
  counts: { retired: 9, deleted: 3, kept: 2, onDisk: 2 },
  keptPaths: [
    '/work/app/.claude/skills/acme-notes',
    '/work/app/.claude/skills/acme-style',
  ],
  onDisk: [
    { kind: 'skills-sh-root', name: 'acme-notes', path: SKILLS_SH_ROOT },
    { kind: 'mcp-home-entry', name: 'acme-files', path: '~/.claude.json' },
  ],
};

const RETIRED_ONLY: InstallMigrationNotice = {
  counts: { retired: 1, deleted: 0, kept: 0, onDisk: 0 },
  keptPaths: [],
  onDisk: [],
};

type Responder = (method: string) => Promise<RpcResult<unknown>>;

describe('InstallScopeMigrationNoticeComponent', () => {
  let fixture: ComponentFixture<InstallScopeMigrationNoticeComponent>;
  let call: jest.Mock;
  let setCurrentView: jest.Mock;
  let emitted: InstallScopeMigrationNoticeAction[];

  function noticeResult(
    notice: InstallMigrationNotice | null,
  ): Promise<RpcResult<unknown>> {
    return Promise.resolve(new RpcResult(true, { notice }));
  }

  async function render(respond: Responder): Promise<HTMLElement> {
    call = jest.fn((method: string) => respond(method));
    setCurrentView = jest.fn();
    emitted = [];
    TestBed.configureTestingModule({
      imports: [InstallScopeMigrationNoticeComponent],
      providers: [
        { provide: ClaudeRpcService, useValue: { call } },
        { provide: AppStateManager, useValue: { setCurrentView } },
      ],
    });
    fixture = TestBed.createComponent(InstallScopeMigrationNoticeComponent);
    fixture.componentInstance.dismissed.subscribe((a) => emitted.push(a));
    await settle();
    return fixture.nativeElement as HTMLElement;
  }

  async function settle(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();
  }

  function q<T extends HTMLElement = HTMLElement>(id: string): T | null {
    return (fixture.nativeElement as HTMLElement).querySelector<T>(
      `[data-testid="${id}"]`,
    );
  }

  afterEach(() => {
    jest.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('renders the region with counts, bullets and both details lists', async () => {
    await render(() => noticeResult(FULL));

    const region = q('install-migration-notice');
    expect(region).not.toBeNull();
    expect(region?.getAttribute('role')).toBe('region');
    const headingId = region?.getAttribute('aria-labelledby') ?? '';
    expect(region?.querySelector(`#${headingId}`)?.textContent).toContain(
      'Installed items no longer load in every workspace',
    );
    expect(call).toHaveBeenCalledWith(GET, {}, expect.anything());

    expect(q('install-migration-retired')?.textContent).toContain(
      '9 shared items were retired',
    );
    expect(q('install-migration-deleted')?.textContent).toContain(
      '3 copies Ptah created itself were deleted.',
    );
    expect(q('install-migration-kept')?.textContent).toContain(
      '2 files were kept in a workspace',
    );
    expect(q('install-migration-on-disk')?.textContent).toContain(
      '(1 skills.sh folder, 1 home-folder MCP entry)',
    );

    const kept = q('install-migration-kept-details');
    expect(kept?.tagName).toBe('DETAILS');
    expect(kept?.querySelector('summary')?.textContent).toContain(
      'Show the 2 files kept in a workspace',
    );
    expect(kept?.querySelectorAll('li')).toHaveLength(2);

    const onDisk = q('install-migration-on-disk-details');
    expect(onDisk?.querySelector('summary')?.textContent).toContain(
      'Show the 2 shared sources left on disk',
    );
    const items = Array.from(onDisk?.querySelectorAll('li') ?? []).map(
      (li) => li.textContent?.trim(),
    );
    expect(items).toEqual([
      `${SKILLS_SH_ROOT} (skills.sh folder)`,
      '~/.claude.json: acme-files (MCP entry)',
    ]);
    expect(region?.textContent).not.toContain('.agents/skills');

    const buttons = Array.from(region?.querySelectorAll('button') ?? []).map(
      (b) => b.textContent?.trim(),
    );
    expect(buttons).toEqual(['Open Marketplace', 'Got it']);
  });

  it('shows a retired-only notice and omits the zero-count bullets and details', async () => {
    await render(() => noticeResult(RETIRED_ONLY));

    expect(q('install-migration-notice')).not.toBeNull();
    expect(q('install-migration-retired')?.textContent).toContain(
      '1 shared item was retired: it no longer loads in every workspace.',
    );
    expect(q('install-migration-deleted')).toBeNull();
    expect(q('install-migration-kept')).toBeNull();
    expect(q('install-migration-on-disk')).toBeNull();
    expect(q('install-migration-kept-details')).toBeNull();
    expect(q('install-migration-on-disk-details')).toBeNull();
  });

  it('stays hidden when all four counts are 0', async () => {
    await render(() =>
      noticeResult({
        counts: { retired: 0, deleted: 0, kept: 0, onDisk: 0 },
        keptPaths: [],
        onDisk: [],
      }),
    );
    expect(q('install-migration-notice')).toBeNull();
  });

  it('shows a notice that the migration completes after the view loaded', async () => {
    jest.useFakeTimers();
    let ready = false;
    await render(() => noticeResult(ready ? RETIRED_ONLY : null));
    expect(q('install-migration-notice')).toBeNull();

    ready = true;
    jest.advanceTimersByTime(INSTALL_MIGRATION_NOTICE_RECHECK_MS[0]);
    await settle();

    expect(q('install-migration-notice')).not.toBeNull();
    expect(call).toHaveBeenCalledTimes(2);
    // Once shown, no further reads are scheduled.
    jest.advanceTimersByTime(10 * 60_000);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('stops re-reading after the bounded schedule and on destroy', async () => {
    jest.useFakeTimers();
    await render(() => noticeResult(null));
    for (const delay of INSTALL_MIGRATION_NOTICE_RECHECK_MS) {
      jest.advanceTimersByTime(delay);
      await settle();
    }
    const reads = 1 + INSTALL_MIGRATION_NOTICE_RECHECK_MS.length;
    expect(call).toHaveBeenCalledTimes(reads);
    jest.advanceTimersByTime(60 * 60_000);
    expect(call).toHaveBeenCalledTimes(reads);

    TestBed.resetTestingModule();
    await render(() => noticeResult(null));
    fixture.destroy();
    jest.advanceTimersByTime(60 * 60_000);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('a failed read shows nothing and retries on the schedule', async () => {
    jest.useFakeTimers();
    let fail = true;
    await render(() =>
      fail
        ? Promise.resolve(new RpcResult(false, undefined, 'EACCES /home/x'))
        : noticeResult(RETIRED_ONLY),
    );
    expect(q('install-migration-notice')).toBeNull();
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain(
      'EACCES',
    );

    fail = false;
    jest.advanceTimersByTime(INSTALL_MIGRATION_NOTICE_RECHECK_MS[0]);
    await settle();
    expect(q('install-migration-notice')).not.toBeNull();
  });

  it('"Got it" records the dismissal, hides the card and emits got-it', async () => {
    await render((method) =>
      method === DISMISS
        ? Promise.resolve(new RpcResult(true, { success: true }))
        : noticeResult(FULL),
    );

    q<HTMLButtonElement>('install-migration-got-it')?.click();
    await settle();

    expect(call).toHaveBeenCalledWith(DISMISS, {}, expect.anything());
    expect(q('install-migration-notice')).toBeNull();
    expect(setCurrentView).not.toHaveBeenCalled();
    expect(emitted).toEqual(['got-it']);
  });

  it('"Open Marketplace" records the dismissal, then opens the marketplace view', async () => {
    await render((method) =>
      method === DISMISS
        ? Promise.resolve(new RpcResult(true, { success: true }))
        : noticeResult(FULL),
    );

    q<HTMLButtonElement>('install-migration-open-marketplace')?.click();
    await settle();

    expect(call).toHaveBeenCalledWith(DISMISS, {}, expect.anything());
    expect(setCurrentView).toHaveBeenCalledWith('marketplace');
    expect(q('install-migration-notice')).toBeNull();
    expect(emitted).toEqual(['open-marketplace']);
  });

  it('a failed dismissal keeps the card, shows fixed copy and never the host error', async () => {
    await render((method) =>
      method === DISMISS
        ? Promise.resolve(
            new RpcResult(false, undefined, 'ENOSPC: /home/dev/.ptah/state'),
          )
        : noticeResult(FULL),
    );

    q<HTMLButtonElement>('install-migration-open-marketplace')?.click();
    await settle();

    expect(q('install-migration-notice')).not.toBeNull();
    const error = q('install-migration-error');
    expect(error?.getAttribute('role')).toBe('alert');
    expect(error?.textContent?.trim()).toBe(
      INSTALL_MIGRATION_NOTICE_DISMISS_ERROR,
    );
    expect(
      (fixture.nativeElement as HTMLElement).textContent,
    ).not.toContain('ENOSPC');
    expect(setCurrentView).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
  });

  it('ignores a second click while the dismissal is in flight', async () => {
    let resolveDismiss: (r: RpcResult<unknown>) => void = () => undefined;
    await render((method) =>
      method === DISMISS
        ? new Promise((resolve) => (resolveDismiss = resolve))
        : noticeResult(FULL),
    );

    q<HTMLButtonElement>('install-migration-got-it')?.click();
    fixture.detectChanges();
    expect(
      q('install-migration-got-it')?.getAttribute('aria-disabled'),
    ).toBe('true');
    q<HTMLButtonElement>('install-migration-open-marketplace')?.click();

    resolveDismiss(new RpcResult(true, { success: true }));
    await settle();

    expect(call.mock.calls.filter(([m]) => m === DISMISS)).toHaveLength(1);
    expect(emitted).toEqual(['got-it']);
  });
});

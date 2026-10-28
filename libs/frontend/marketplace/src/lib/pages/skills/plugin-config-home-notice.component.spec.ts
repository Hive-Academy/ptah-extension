/**
 * PluginConfigHomeNoticeComponent specs (D14, plan :1338-1355).
 *
 * The catalogue is a stub with a writable `configHome`; the inventory is a
 * stub whose `reload` the "then reloads the catalogue" step is checked
 * against. RPC answers are controlled per test, including one held open to
 * check the busy state.
 */

import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  ClaudeRpcService,
  PluginCatalogService,
  WorkspaceScopeService,
} from '@ptah-extension/core';
import type {
  PluginConfigHomeCandidate,
  PluginConfigHomeStatus,
} from '@ptah-extension/shared';
import { MarketplaceInventoryStore } from '../../data/marketplace-inventory.store';
import {
  PluginConfigHomeNoticeComponent,
  configHomeBlocks,
  relativeFolder,
} from './plugin-config-home-notice.component';

function ok<T>(data: T) {
  return { success: true, data, error: undefined, isSuccess: () => true };
}

function fail(error: string) {
  return { success: false, data: undefined, error, isSuccess: () => false };
}

function candidate(
  folder: string,
  overrides: Partial<PluginConfigHomeCandidate> = {},
): PluginConfigHomeCandidate {
  return {
    folder,
    enabledCount: 1,
    disabledCount: 0,
    differsFromHome: true,
    ...overrides,
  };
}

const ROOT = 'C:\\repo';

function status(
  state: PluginConfigHomeStatus['state'],
  candidates: PluginConfigHomeCandidate[],
  governingFolder?: string,
): PluginConfigHomeStatus {
  return {
    harnessRoot: ROOT,
    state,
    candidates,
    ...(governingFolder === undefined ? {} : { governingFolder }),
  };
}

@Component({
  standalone: true,
  imports: [PluginConfigHomeNoticeComponent],
  template: `<ptah-plugin-config-home-notice
    (failed)="failures.push($event)"
  />`,
})
class HostComponent {
  public readonly failures: (string | null)[] = [];
}

describe('PluginConfigHomeNoticeComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let configHome: ReturnType<typeof signal<PluginConfigHomeStatus | null>>;
  let call: jest.Mock;
  let reload: jest.Mock;
  let recordLibraryPass: jest.Mock;
  let generation: ReturnType<typeof signal<number>>;

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const notices = (): HTMLElement[] =>
    Array.from(
      el().querySelectorAll<HTMLElement>(
        '[data-testid="plugin-config-home-notice"]',
      ),
    );
  const buttons = (): HTMLButtonElement[] =>
    Array.from(
      el().querySelectorAll<HTMLButtonElement>(
        '[data-testid="plugin-config-home-action"]',
      ),
    );
  const settle = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(() => {
    configHome = signal<PluginConfigHomeStatus | null>(null);
    call = jest.fn().mockResolvedValue(ok({}));
    reload = jest.fn().mockResolvedValue(undefined);
    recordLibraryPass = jest.fn();
    generation = signal(4);
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        { provide: ClaudeRpcService, useValue: { call } },
        {
          provide: PluginCatalogService,
          useValue: { configHome: configHome.asReadonly() },
        },
        {
          provide: MarketplaceInventoryStore,
          useValue: { reload, recordLibraryPass },
        },
        {
          provide: WorkspaceScopeService,
          useValue: { generation: generation.asReadonly() },
        },
      ],
    });
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  afterEach(() => TestBed.resetTestingModule());

  it('renders nothing when the catalogue has no status', () => {
    expect(notices()).toEqual([]);
    expect(el().textContent?.trim()).toBe('');
  });

  it('renders nothing for the home state', () => {
    configHome.set(status('home', [candidate('C:\\repo\\a')]));
    fixture.detectChanges();

    expect(notices()).toEqual([]);
  });

  it('shows the conflict as an alert with one button per candidate', () => {
    configHome.set(
      status(
        'conflict',
        [
          candidate('C:\\repo\\packages\\app', {
            lastUpdated: '2026-10-01T12:00:00.000Z',
          }),
          candidate('C:\\repo\\tools'),
        ],
        'C:\\repo\\packages\\app',
      ),
    );
    fixture.detectChanges();

    const [notice] = notices();
    expect(notice.getAttribute('role')).toBe('alert');
    const text = notice.querySelector('p')?.textContent?.trim() ?? '';
    expect(text).toMatch(
      /^Folders in this repository have different plugin settings\. Ptah is using the settings saved in packages\/app on .*2026.* until you choose\.$/,
    );
    expect(buttons().map((b) => b.textContent?.trim())).toEqual([
      'Use settings from packages/app',
      'Use settings from tools',
    ]);
  });

  it('shows a differing folder as a status with Use and Dismiss', () => {
    configHome.set(
      status('differs', [
        candidate('C:\\repo\\web'),
        candidate('C:\\repo\\same', { differsFromHome: false }),
      ]),
    );
    fixture.detectChanges();

    expect(notices()).toHaveLength(1);
    expect(notices()[0].getAttribute('role')).toBe('status');
    expect(notices()[0].querySelector('p')?.textContent?.trim()).toBe(
      "web has its own saved plugin settings that differ from this repository's. They are kept but not applied.",
    );
    expect(buttons().map((b) => b.textContent?.trim())).toEqual([
      'Use settings from web',
      'Dismiss',
    ]);
  });

  it('shows an import as a status with Dismiss', () => {
    configHome.set(
      status('imported', [
        candidate('C:\\repo\\api', { differsFromHome: false }),
      ]),
    );
    fixture.detectChanges();

    expect(notices()[0].getAttribute('role')).toBe('status');
    expect(notices()[0].querySelector('p')?.textContent?.trim()).toBe(
      'Plugin settings saved in api now apply to the whole repository.',
    );
    expect(buttons().map((b) => b.textContent?.trim())).toEqual(['Dismiss']);
  });

  it('calls resolve-config-home with the candidate folder, then reloads the catalogue', async () => {
    configHome.set(status('differs', [candidate('C:\\repo\\web')]));
    fixture.detectChanges();

    buttons()[0].click();
    await settle();

    expect(call).toHaveBeenCalledWith(
      'plugins:resolve-config-home',
      { action: 'adopt', folder: 'C:\\repo\\web' },
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
    expect(reload).toHaveBeenCalledWith('plugins');
    expect(call.mock.invocationCallOrder[0]).toBeLessThan(
      reload.mock.invocationCallOrder[0],
    );
    expect(fixture.componentInstance.failures).toEqual([null]);
  });

  it('hands an adopt answer of libraryPass failed to the inventory (C10) before the reload', async () => {
    call.mockResolvedValue(ok({ libraryPass: 'failed' }));
    configHome.set(status('differs', [candidate('C:\\repo\\web')]));
    fixture.detectChanges();

    buttons()[0].click();
    // The workspace the call started under is the one recorded, even when the
    // generation moves before the answer lands (the store then drops it).
    generation.set(5);
    await settle();

    expect(recordLibraryPass).toHaveBeenCalledWith('failed', 4);
    expect(recordLibraryPass.mock.invocationCallOrder[0]).toBeLessThan(
      reload.mock.invocationCallOrder[0],
    );
  });

  it('records nothing when the call fails', async () => {
    call.mockResolvedValue(fail('C:\\Users\\secret\\x'));
    configHome.set(status('differs', [candidate('C:\\repo\\web')]));
    fixture.detectChanges();

    buttons()[0].click();
    await settle();

    expect(recordLibraryPass).not.toHaveBeenCalled();
    expect(fixture.componentInstance.failures.at(-1)).not.toContain('secret');
  });

  it('disables every button and marks the notice busy while the call runs', async () => {
    let answer!: (value: unknown) => void;
    call.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    configHome.set(status('differs', [candidate('C:\\repo\\web')]));
    fixture.detectChanges();

    buttons()[1].click();
    fixture.detectChanges();

    expect(buttons().every((b) => b.disabled)).toBe(true);
    expect(notices()[0].getAttribute('aria-busy')).toBe('true');
    expect(buttons()[1].querySelector('.loading')).toBeTruthy();
    buttons()[0].click();
    expect(call).toHaveBeenCalledTimes(1);

    answer(ok({}));
    await settle();

    expect(buttons().every((b) => !b.disabled)).toBe(true);
    expect(notices()[0].getAttribute('aria-busy')).toBe('false');
  });

  it.each([
    ['a failed result', () => Promise.resolve(fail('EACCES: C:\\repo\\x'))],
    ['a thrown error', () => Promise.reject(new Error('socket hang up'))],
  ])(
    'emits fixed failure copy for %s and does not reload',
    async (_, answer) => {
      call.mockImplementation(answer);
      configHome.set(status('differs', [candidate('C:\\repo\\web')]));
      fixture.detectChanges();

      buttons()[0].click();
      await settle();

      expect(fixture.componentInstance.failures).toEqual([
        null,
        'Could not use the plugin settings from web. Try again.',
      ]);
      expect(reload).not.toHaveBeenCalled();
      expect(buttons().every((b) => !b.disabled)).toBe(true);
    },
  );

  describe('relativeFolder', () => {
    it.each([
      ['C:\\repo', 'C:\\repo\\packages\\app', 'packages/app'],
      ['C:\\Repo\\', 'c:\\repo\\web', 'web'],
      ['/home/me/repo', '/home/me/repo/api', 'api'],
      ['/home/me/repo', '/home/me/repo', '.'],
      ['/home/me/repo', '/home/me/other', '/home/me/other'],
      ['/home/me/repo', '/home/me/repository/x', '/home/me/repository/x'],
    ])('shows %s + %s as %s', (root, folder, shown) => {
      expect(relativeFolder(root, folder)).toBe(shown);
    });
  });

  it('builds no block for a status without candidates', () => {
    expect(configHomeBlocks(status('differs', []))).toEqual([]);
  });
});

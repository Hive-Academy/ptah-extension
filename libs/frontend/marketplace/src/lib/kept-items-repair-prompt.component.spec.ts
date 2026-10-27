import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import type {
  KeptItem,
  LocalItemFamily,
  PluginsReplaceKeptItemsResult,
} from '@ptah-extension/shared';
import { makeLibraryAgreementFixtures } from '@ptah-extension/shared/testing';
import {
  KeptItemsRepairPromptComponent,
  familyReplaceLabel,
  isRepairableFamily,
  keptReasonLabel,
  repairConfirmLabel,
} from './kept-items-repair-prompt.component';

function ok<T>(data: T) {
  return {
    success: true,
    data,
    error: undefined as string | undefined,
    isSuccess: (): boolean => true,
  };
}

function fail(error: string) {
  return {
    success: false,
    data: undefined,
    error,
    isSuccess: (): boolean => false,
  };
}

/**
 * Kept items of each installer family, named from the shared agreement
 * fixture (design 3.4 / R1-3): skills.sh keeps `tailwind-v4/SKILL.md`, plugin
 * enable keeps `release-notes/SKILL.md` and the unreadable `release.md`, and
 * plugin-agent mirroring keeps `.claude/agents/release-manager.md`.
 */
function familyItems(): Record<
  'skills-sh' | 'plugin-enable' | 'plugin-agent',
  KeptItem[]
> {
  const fixtures = makeLibraryAgreementFixtures();
  const releaseKit = fixtures.pluginWithSkillsAndAgents.plugins[0];
  const tailwind = fixtures.communitySkill.plugins.find(
    (plugin) => plugin.source === 'skillssh',
  );
  const skill = tailwind?.skillNames?.[0] ?? 'missing-fixture';
  const releaseSkill = releaseKit.skillNames?.[0] ?? 'missing-fixture';
  const releaseCommand = releaseKit.commandNames?.[0] ?? 'missing-fixture';
  const releaseAgent = releaseKit.agentNames?.[0] ?? 'missing-fixture';
  return {
    'skills-sh': [
      {
        approvalId: 'ss-1',
        family: 'skills-sh',
        target: 'claude',
        relPath: `.claude/skills/${skill}/SKILL.md`,
        reason: 'unowned',
      },
    ],
    'plugin-enable': [
      {
        approvalId: 'pe-1',
        family: 'plugin-enable',
        target: 'claude',
        relPath: `.claude/skills/${releaseSkill}/SKILL.md`,
        reason: 'owned-edited',
      },
      {
        approvalId: 'pe-2',
        family: 'plugin-enable',
        target: 'claude',
        relPath: `.claude/commands/${releaseCommand}.md`,
        reason: 'unreadable',
      },
    ],
    'plugin-agent': [
      {
        approvalId: 'pa-1',
        family: 'plugin-agent',
        target: 'claude',
        relPath: `.claude/agents/${releaseAgent}.md`,
        reason: 'owned-edited',
      },
    ],
  };
}

function allItems(): KeptItem[] {
  const byFamily = familyItems();
  return [
    ...byFamily['skills-sh'],
    ...byFamily['plugin-enable'],
    ...byFamily['plugin-agent'],
  ];
}

describe('KeptItemsRepairPromptComponent', () => {
  let fixture: ComponentFixture<KeptItemsRepairPromptComponent>;
  let component: KeptItemsRepairPromptComponent;
  let host: HTMLElement;
  const rpcMock = { call: jest.fn() };

  const render = (family: LocalItemFamily, items = allItems()): void => {
    fixture = TestBed.createComponent(KeptItemsRepairPromptComponent);
    component = fixture.componentInstance;
    host = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('family', family);
    fixture.componentRef.setInput('items', items);
    fixture.detectChanges();
  };

  const rows = (): HTMLElement[] =>
    Array.from(
      host.querySelectorAll<HTMLElement>('[data-testid="kept-item-row"]'),
    );
  const confirmButton = (): HTMLButtonElement | null =>
    host.querySelector<HTMLButtonElement>(
      '[data-testid="kept-items-repair-confirm"]',
    );
  const replaceSegment = (row: HTMLElement): HTMLButtonElement | null =>
    row.querySelector<HTMLButtonElement>('[data-testid="replace-segment"]');
  const settle = async (): Promise<void> => {
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(() => {
    rpcMock.call.mockReset();
    TestBed.configureTestingModule({
      imports: [KeptItemsRepairPromptComponent],
      providers: [{ provide: ClaudeRpcService, useValue: rpcMock }],
    });
  });

  it('opens with the title, the keep-first sentence and every row on Keep', () => {
    render('plugin-enable');
    expect(host.textContent).toContain('Replace kept files?');
    expect(host.textContent).toContain(
      'Nothing is replaced until you confirm. Choices start at Keep.',
    );
    for (const row of rows()) {
      expect(
        row
          .querySelector('[data-testid="keep-segment"]')
          ?.getAttribute('aria-checked'),
      ).toBe('true');
    }
    expect(confirmButton()?.textContent?.trim()).toBe(
      'Close without replacing',
    );
  });

  it.each([
    [
      'skills-sh',
      ['.claude/skills/tailwind-v4/SKILL.md'],
      'Replace with skills.sh version',
    ],
    [
      'plugin-enable',
      ['.claude/skills/release-notes/SKILL.md', '.claude/commands/release.md'],
      'Replace with plugin version',
    ],
    [
      'plugin-agent',
      ['.claude/agents/release-manager.md'],
      'Replace with plugin version',
    ],
  ] as const)(
    'is bound to the opening family %s: only its items, with its replace label',
    (family, paths, label) => {
      render(family);
      expect(rows().map((row) => row.dataset['path'])).toEqual([...paths]);
      expect(
        host
          .querySelector('[data-testid="kept-items-repair"]')
          ?.getAttribute('data-family'),
      ).toBe(family);
      expect(replaceSegment(rows()[0])?.textContent?.trim()).toBe(label);
    },
  );

  it('plugin-agent lists the release-manager agent row with Keep checked and a count', () => {
    render('plugin-agent');
    const [row] = rows();
    expect(row.textContent).toContain('.claude/agents/release-manager.md');
    expect(row.textContent).toContain('Edited since Ptah wrote it');
    replaceSegment(row)?.click();
    fixture.detectChanges();
    expect(component.replaceCount()).toBe(1);
    expect(confirmButton()?.textContent?.trim()).toBe('Replace 1 file');
  });

  it('forces Keep for an unreadable item, even through Replace all', () => {
    render('plugin-enable');
    const unreadable = rows().find((row) =>
      row.dataset['path']?.endsWith('release.md'),
    );
    expect(unreadable).toBeTruthy();
    if (!unreadable) return;
    const segment = replaceSegment(unreadable);
    expect(segment?.getAttribute('aria-disabled')).toBe('true');
    expect(unreadable.textContent).toContain(
      'Replace is not available for it.',
    );

    segment?.click();
    fixture.detectChanges();
    expect(component.replaceCount()).toBe(0);

    const replaceAll = Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Replace all',
    );
    replaceAll?.click();
    fixture.detectChanges();
    expect(component.replaceCount()).toBe(1);
    expect(segment?.getAttribute('aria-checked')).toBe('false');
    expect(confirmButton()?.textContent?.trim()).toBe('Replace 1 file');
  });

  it('closes without a call when nothing is chosen for replace', async () => {
    render('skills-sh');
    const closed = jest.fn();
    component.closed.subscribe(closed);
    confirmButton()?.click();
    await settle();
    expect(rpcMock.call).not.toHaveBeenCalled();
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('calls plugins:replace-kept-items with a decision per shown item and shows the result', async () => {
    const result: PluginsReplaceKeptItemsResult = {
      replaced: [familyItems()['plugin-enable'][0]],
      kept: [familyItems()['plugin-enable'][1]],
      libraryPass: 'updated',
    };
    rpcMock.call.mockResolvedValue(ok(result));
    render('plugin-enable');
    const replaced = jest.fn();
    component.replaced.subscribe(replaced);

    component.setAll('replace');
    fixture.detectChanges();
    confirmButton()?.click();
    await settle();

    expect(rpcMock.call).toHaveBeenCalledTimes(1);
    const [method, params] = rpcMock.call.mock.calls[0];
    expect(method).toBe('plugins:replace-kept-items');
    expect(params).toEqual({
      decisions: { 'pe-1': 'replace', 'pe-2': 'keep' },
    });
    expect(replaced).toHaveBeenCalledWith(result);

    const outcome = host.querySelector(
      '[data-testid="kept-items-repair-result"]',
    );
    expect(outcome?.textContent).toContain('Replaced');
    expect(outcome?.textContent).toContain('Could not read file');
    expect(
      host.querySelector('[data-testid="kept-items-repair-done"]'),
    ).toBeTruthy();
  });

  it('marks a kept item whose replace failed without rendering the raw error', async () => {
    rpcMock.call.mockResolvedValue(
      ok({
        replaced: [],
        kept: [
          {
            ...familyItems()['plugin-agent'][0],
            error: 'EACCES: /secret/path',
          },
        ],
        libraryPass: 'not-applicable',
      }),
    );
    render('plugin-agent');
    component.setAll('replace');
    fixture.detectChanges();
    confirmButton()?.click();
    await settle();
    expect(host.textContent).toContain('Kept: could not replace');
    expect(host.textContent).not.toContain('EACCES');
  });

  it('keeps the prompt open with the choices after a failed call', async () => {
    rpcMock.call.mockResolvedValue(
      fail('Some of these items can no longer be replaced from here.'),
    );
    render('plugin-agent');
    const closed = jest.fn();
    component.closed.subscribe(closed);
    component.setAll('replace');
    fixture.detectChanges();
    confirmButton()?.click();
    await settle();

    expect(closed).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      'can no longer be replaced',
    );
    expect(component.replaceCount()).toBe(1);
    expect(confirmButton()?.disabled).toBe(false);
  });

  it('uses fixed copy for a thrown transport error', async () => {
    rpcMock.call.mockRejectedValue(new Error('socket hang up at 0x1f'));
    render('plugin-agent');
    component.setAll('replace');
    fixture.detectChanges();
    confirmButton()?.click();
    await settle();
    const alert = host.querySelector('[role="alert"]')?.textContent ?? '';
    expect(alert).toContain('the replace request did not complete.');
    expect(alert).not.toContain('socket');
  });

  it('shows C10 only when enabled and the Library refresh failed', async () => {
    rpcMock.call.mockResolvedValue(
      ok({
        replaced: familyItems()['plugin-agent'],
        kept: [],
        libraryPass: 'failed',
      }),
    );
    render('plugin-agent');
    fixture.componentRef.setInput('showLibraryNotice', true);
    component.setAll('replace');
    fixture.detectChanges();
    confirmButton()?.click();
    await settle();
    expect(
      host.querySelector('[data-testid="library-stale-notice"]'),
    ).toBeTruthy();
  });

  it('cancels on Escape and wraps Tab inside the dialog', () => {
    render('plugin-enable');
    const closed = jest.fn();
    component.closed.subscribe(closed);
    const dialog = host.querySelector<HTMLElement>(
      '[data-testid="kept-items-repair"]',
    );
    const stops = Array.from(
      dialog?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ??
        [],
    ).filter((button) => button.tabIndex !== -1);
    const last = stops[stops.length - 1];
    last.focus();
    dialog?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(document.activeElement).toBe(stops[0]);

    stops[0].focus();
    dialog?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(document.activeElement).toBe(last);

    dialog?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(closed).toHaveBeenCalledTimes(1);
  });
});

describe('repair prompt copy helpers', () => {
  it('names each reason', () => {
    expect(keptReasonLabel('unowned')).toBe('Not created by Ptah');
    expect(keptReasonLabel('owned-edited')).toBe('Edited since Ptah wrote it');
    expect(keptReasonLabel('unreadable')).toBe('Could not read file');
    expect(keptReasonLabel('changed-since-approval')).toBe(
      'Kept: changed since approval',
    );
  });

  it('routes only the no-dialog families and labels their source', () => {
    expect(isRepairableFamily('external')).toBe(false);
    expect(isRepairableFamily('skills-sh')).toBe(true);
    expect(isRepairableFamily('plugin-enable')).toBe(true);
    expect(isRepairableFamily('plugin-agent')).toBe(true);
    expect(familyReplaceLabel('skills-sh')).toBe(
      'Replace with skills.sh version',
    );
    expect(repairConfirmLabel(2)).toBe('Replace 2 files');
  });
});

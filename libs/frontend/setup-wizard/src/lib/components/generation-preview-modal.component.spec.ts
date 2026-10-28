import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ThemeService } from '@ptah-extension/core';
import type {
  FileDecision,
  GenerationRivalStatus,
  GenerationTargetChoice,
  WizardPreviewGenerationResponse,
} from '@ptah-extension/shared';
import type { PreviewRowDecision } from './agent-preview-dialog.component';
import { GenerationPreviewModalComponent } from './generation-preview-modal.component';
import {
  buildWizardRows,
  nextSnapshot,
  setDecision,
  type DecisionSnapshot,
} from './preview-decisions/preview-decisions.state';

const target = {
  harnessRoot: 'D:/work/acme',
  openedFolder: 'D:/work/acme/packages/api',
  chosen: 'harness-root' as const,
  openedIsHarnessRoot: false,
};

const preview: WizardPreviewGenerationResponse = {
  previewToken: 'token-1',
  target,
  rivalStatus: 'listed',
  agents: [
    {
      agentId: 'backend-developer',
      agentModel: { value: 'opus', origin: 'machine' },
      files: [
        {
          relPath: '.claude/agents/backend-developer.md',
          target: 'claude',
          certainty: 'definite',
          willOverwrite: true,
          localState: 'exists',
          revision: 'rev-b',
        },
        {
          relPath: '.codex/agents/backend-developer.toml',
          target: 'codex',
          certainty: 'definite',
          willOverwrite: false,
        },
        {
          relPath: '.gemini/agents/backend-developer.md',
          target: 'gemini',
          certainty: 'conditional',
          condition: 'agent sync is enabled for this agent',
          willOverwrite: false,
        },
      ],
    },
    {
      agentId: 'planner',
      files: [
        {
          relPath: '.claude/agents/planner.md',
          target: 'claude',
          certainty: 'definite',
          willOverwrite: true,
          localState: 'unreadable',
        },
      ],
    },
    {
      agentId: 'tester',
      files: [
        {
          relPath: '.claude/agents/tester.md',
          target: 'claude',
          certainty: 'definite',
          willOverwrite: false,
          localState: 'new',
        },
      ],
    },
  ],
};

function snapshotOf(
  value: WizardPreviewGenerationResponse,
  choice: GenerationTargetChoice | null = 'harness-root',
): DecisionSnapshot {
  return nextSnapshot(null, buildWizardRows(value), choice);
}

// jsdom lacks the native dialog methods; keep the open attribute like the NativeModal specs.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});

describe('GenerationPreviewModalComponent', () => {
  let fixture: ComponentFixture<GenerationPreviewModalComponent>;
  let decisions: PreviewRowDecision[];
  let bulk: FileDecision[];
  let targets: GenerationTargetChoice[];
  let confirms: number;
  let dismissals: number;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: ThemeService, useValue: { isDarkMode: signal(true) } },
      ],
    });
  });

  function create(
    inputs: Partial<{
      preview: WizardPreviewGenerationResponse | null;
      snapshot: DecisionSnapshot | null;
      changed: boolean;
      loading: boolean;
      error: boolean;
      generating: boolean;
      isElectron: boolean;
    }> = {},
  ): void {
    fixture = TestBed.createComponent(GenerationPreviewModalComponent);
    decisions = [];
    bulk = [];
    targets = [];
    confirms = 0;
    dismissals = 0;
    const instance = fixture.componentInstance;
    instance.decisionChange.subscribe((value) => decisions.push(value));
    instance.applyAll.subscribe((value) => bulk.push(value));
    instance.targetChange.subscribe((value) => targets.push(value));
    instance.confirm.subscribe(() => confirms++);
    instance.dismissed.subscribe(() => dismissals++);
    fixture.componentRef.setInput('open', true);
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
  }

  const dialog = (): HTMLDialogElement =>
    fixture.nativeElement.querySelector('dialog');
  const query = <T extends HTMLElement = HTMLElement>(
    selector: string,
  ): T | null => fixture.nativeElement.querySelector(selector);
  const queryAll = <T extends HTMLElement = HTMLElement>(
    selector: string,
  ): T[] => Array.from(fixture.nativeElement.querySelectorAll(selector));
  const confirmButton = (): HTMLButtonElement =>
    query<HTMLButtonElement>(
      '[data-testid="preview-confirm"]',
    ) as HTMLButtonElement;

  it('starts every existing file on Keep and labels confirm "Confirm Generate"', () => {
    create({ preview, snapshot: snapshotOf(preview) });

    expect(dialog().open).toBe(true);
    expect(dialog().getAttribute('aria-label')).toBe(
      'Preview agent generation',
    );
    const keep = queryAll('[data-testid="keep-segment"]');
    expect(keep.length).toBe(2);
    for (const segment of keep) {
      expect(segment.getAttribute('aria-checked')).toBe('true');
    }
    expect(
      queryAll('[data-testid="file-state-badge"]').map((badge) =>
        badge.textContent?.trim(),
      ),
    ).toEqual(['Exists — may be replaced', 'Could not read file', 'New']);
    expect(confirmButton().textContent?.trim()).toBe('Confirm Generate');
    expect(query('[data-testid="decision-summary"]')?.textContent).toBe(
      '2 kept, 0 to replace',
    );
    // The old "will overwrite" marker is replaced by the state badge.
    expect(dialog().textContent).not.toContain('will overwrite');
  });

  it('counts a Replace in the summary and the confirm label', () => {
    const snapshot = setDecision(
      snapshotOf(preview),
      'backend-developer',
      'replace',
    );
    create({ preview, snapshot });

    expect(confirmButton().textContent?.trim()).toBe(
      'Confirm Generate, replace 1 file',
    );
    expect(query('[data-testid="decision-summary"]')?.textContent).toBe(
      '1 kept, 1 to replace',
    );
  });

  it('reports row and bulk choices to the owner', () => {
    create({ preview, snapshot: snapshotOf(preview) });

    query<HTMLButtonElement>(
      '[data-agent="backend-developer"] [data-testid="replace-segment"]',
    )?.click();
    query<HTMLButtonElement>('[data-testid="bulk-replace"]')?.click();

    expect(decisions).toEqual([
      { id: 'backend-developer', decision: 'replace' },
    ]);
    expect(bulk).toEqual(['replace']);
  });

  it('forces Keep for an unreadable file', () => {
    create({ preview, snapshot: snapshotOf(preview) });

    const replace = query<HTMLButtonElement>(
      '[data-agent="planner"] [data-testid="replace-segment"]',
    );
    expect(replace?.getAttribute('aria-disabled')).toBe('true');
    expect(replace?.getAttribute('tabindex')).toBe('-1');
    replace?.click();
    expect(decisions).toEqual([]);
    expect(query('[data-agent="planner"]')?.textContent).toContain(
      'Ptah could not compare this file',
    );
    // The bulk bar counts only the one controllable file.
    expect(query('[data-testid="bulk-decision-bar"]')?.textContent).toContain(
      '1 existing file',
    );
  });

  it('lists rival-CLI and conditional files as information only', () => {
    create({ preview, snapshot: snapshotOf(preview) });

    const info = query(
      '[data-agent="backend-developer"] [data-testid="info-only-targets"]',
    );
    expect(info?.textContent).toContain(
      'Also copied for other CLIs (information only; not controlled by Keep or Replace)',
    );
    expect(info?.textContent).toContain('.codex/agents/backend-developer.toml');
    const conditional = info?.querySelector(
      '[data-testid="conditional-files"]',
    );
    expect(conditional?.textContent).toContain(
      'May also write, if agent sync is enabled for this agent',
    );
    expect(conditional?.textContent).toContain(
      '.gemini/agents/backend-developer.md',
    );
    expect(info?.querySelector('[role="radiogroup"]')).toBeNull();
    expect(query('[data-testid="preview-warning"]')).toBeNull();
  });

  it.each<[GenerationRivalStatus, string]>([
    [
      'harness-unavailable',
      'Harness sync is not available on this host. Only the Claude files are listed.',
    ],
    [
      'cli-detection-failed',
      'Could not check which CLIs are installed. Rival-CLI copies are not listed, so this list may be incomplete.',
    ],
  ])(
    'shows the %s warning and lists no rival rows (R1-5)',
    (rivalStatus, warning) => {
      const value = { ...preview, rivalStatus, warning };
      create({ preview: value, snapshot: snapshotOf(value) });

      expect(
        query('[data-testid="preview-warning"]')?.textContent?.trim(),
      ).toBe(warning);
      expect(
        query('[data-testid="preview-warning"]')?.getAttribute('role'),
      ).toBe('alert');
      expect(dialog().textContent).not.toContain('.codex/agents');
      expect(dialog().textContent).not.toContain('.gemini/agents');
      expect(dialog().textContent).toContain(
        '.claude/agents/backend-developer.md',
      );
    },
  );

  it('shows the sub-folder warning only for the opened-folder target', () => {
    const warning =
      'Other CLIs sync agents from a different folder than the one this preview writes to.';
    const opened = {
      ...preview,
      rivalStatus: 'opened-folder-elsewhere' as const,
      warning,
      target: { ...target, chosen: 'opened-folder' as const },
    };
    create({ preview: opened, snapshot: snapshotOf(opened, 'opened-folder') });
    expect(query('[data-testid="preview-warning"]')?.textContent?.trim()).toBe(
      warning,
    );

    fixture.componentRef.setInput(
      'snapshot',
      snapshotOf(opened, 'harness-root'),
    );
    fixture.detectChanges();
    expect(query('[data-testid="preview-warning"]')).toBeNull();
  });

  it('shows the target choice and reports a target change', () => {
    create({ preview, snapshot: snapshotOf(preview) });

    expect(
      query('[data-testid="target-root"]')?.getAttribute('aria-checked'),
    ).toBe('true');
    expect(query('[data-testid="writing-to"]')?.textContent).toContain(
      'D:/work/acme/.claude/agents',
    );
    query<HTMLButtonElement>('[data-testid="target-opened"]')?.click();
    expect(targets).toEqual(['opened-folder']);
  });

  it('shows only the target path when the opened folder is the project root', () => {
    const same = {
      ...preview,
      target: {
        ...target,
        openedFolder: target.harnessRoot,
        openedIsHarnessRoot: true,
      },
    };
    create({ preview: same, snapshot: snapshotOf(same) });

    expect(query('[data-testid="target-radiogroup"]')).toBeNull();
    expect(query('[data-testid="writing-to"]')?.textContent).toContain(
      'D:/work/acme/.claude/agents',
    );
  });

  it('replaces the list with the checking state while loading and keeps the target visible', () => {
    create({ preview, snapshot: snapshotOf(preview), loading: true });

    expect(dialog().textContent).toContain('Checking generation targets...');
    expect(query('[aria-busy="true"]')).not.toBeNull();
    expect(query('[data-testid="file-decision-row"]')).toBeNull();
    expect(confirmButton().disabled).toBe(true);
    expect(
      query<HTMLButtonElement>('[data-testid="target-opened"]')?.disabled,
    ).toBe(true);
  });

  it('shows the target-changed status line from the snapshot', () => {
    const first = snapshotOf(preview, 'harness-root');
    const reset = nextSnapshot(
      first,
      buildWizardRows(preview),
      'opened-folder',
    );
    create({ preview, snapshot: reset });

    expect(
      query('[data-testid="target-reset-status"]')?.textContent?.trim(),
    ).toBe(
      'Target changed. The comparison was run again and every choice is reset to Keep.',
    );
    expect(
      query('[data-testid="target-reset-status"]')?.getAttribute('role'),
    ).toBe('status');
  });

  it('offers "Generate without preview" with the create-only copy after a failure', () => {
    create({ preview: null, snapshot: null, error: true });

    expect(dialog().textContent).toContain(
      'Preview unavailable. You can still generate without a preview. Files that already exist and differ will be kept; only missing files are created.',
    );
    expect(confirmButton().textContent?.trim()).toBe(
      'Generate without preview',
    );
    expect(confirmButton().disabled).toBe(false);
    confirmButton().click();
    expect(confirms).toBe(1);
  });

  it('shows the stale-targets alert', () => {
    create({ preview, snapshot: snapshotOf(preview), changed: true });

    expect(dialog().textContent).toContain(
      'Targets changed since preview. Review the new list and confirm again.',
    );
  });

  it('labels the agent model through the model note', () => {
    create({ preview, snapshot: snapshotOf(preview) });

    expect(query('[data-agent="backend-developer"]')?.textContent).toContain(
      'Agent model:',
    );
    expect(query('[data-agent="backend-developer"]')?.textContent).toContain(
      'opus',
    );
  });

  it('dismisses on Cancel and disables decisions while generating', () => {
    create({ preview, snapshot: snapshotOf(preview), generating: true });

    expect(confirmButton().disabled).toBe(true);
    const cancel = queryAll<HTMLButtonElement>('[modal-footer] button')[0];
    cancel.click();
    expect(dismissals).toBe(1);
  });
});

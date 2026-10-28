import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ThemeService } from '@ptah-extension/core';
import type {
  FileDecision,
  GenerationTargetChoice,
  WizardPreviewGenerationResponse,
} from '@ptah-extension/shared';
import {
  AgentPreviewDialogComponent,
  type PreviewRowDecision,
} from './agent-preview-dialog.component';
import {
  buildWizardRows,
  nextSnapshot,
  setDecision,
  type DecisionSnapshot,
} from './preview-decisions/preview-decisions.state';

const target = {
  harnessRoot: 'D:/work/acme',
  openedFolder: 'D:/work/acme/packages/web',
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
          relPath: '.cursor/agents/backend-developer.md',
          target: 'cursor',
          certainty: 'conditional',
          condition: 'if agent sync is enabled for this agent',
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

describe('AgentPreviewDialogComponent', () => {
  let fixture: ComponentFixture<AgentPreviewDialogComponent>;
  let decisions: PreviewRowDecision[];
  let bulk: FileDecision[];
  let targets: GenerationTargetChoice[];

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
      model: string | null;
      isElectron: boolean;
    }> = {},
  ): void {
    fixture = TestBed.createComponent(AgentPreviewDialogComponent);
    decisions = [];
    bulk = [];
    targets = [];
    fixture.componentInstance.decisionChange.subscribe((value) =>
      decisions.push(value),
    );
    fixture.componentInstance.applyAll.subscribe((value) => bulk.push(value));
    fixture.componentInstance.targetChange.subscribe((value) =>
      targets.push(value),
    );
    fixture.componentRef.setInput('open', true);
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
  }

  const dialog = (): HTMLElement =>
    fixture.nativeElement.querySelector('[role="dialog"]');
  const query = <T extends HTMLElement = HTMLElement>(
    selector: string,
  ): T | null => fixture.nativeElement.querySelector(selector);
  const queryAll = (selector: string): HTMLElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll(selector));
  /** Visible parts of a flex line, one space between them. */
  const words = (selector: string): string =>
    Array.from(query(selector)?.childNodes ?? [])
      .filter((node) => node.nodeType !== Node.COMMENT_NODE)
      .map((node) => (node.textContent ?? '').trim())
      .filter(Boolean)
      .join(' ');

  it('shows certainty and changed target warning, and Escape cancels', () => {
    const cancel = jest.fn();
    create({
      changed: true,
      preview: {
        agents: [
          {
            agentId: 'frontend-developer',
            files: [
              {
                relPath: '.claude/agents/frontend.md',
                target: 'claude',
                certainty: 'definite',
                willOverwrite: true,
              },
            ],
          },
        ],
      },
    });
    fixture.componentInstance.dismissed.subscribe(cancel);
    expect(dialog().textContent).toContain('definite');
    expect(dialog().textContent).toContain('Targets changed');
    dialog().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('starts every existing-file row on Keep with the plain confirm label (R1-4)', () => {
    create({ preview, snapshot: snapshotOf(preview) });
    const keeps = queryAll('[data-testid="keep-segment"]');
    expect(keeps).toHaveLength(2);
    for (const keep of keeps) {
      expect(keep.getAttribute('aria-checked')).toBe('true');
    }
    expect(query('[data-testid="preview-confirm"]')?.textContent?.trim()).toBe(
      'Confirm and generate',
    );
    expect(query('[data-testid="decision-summary"]')?.textContent).toBe(
      '2 kept, 0 to replace',
    );
    // The new file has no control.
    expect(dialog().textContent).toContain('.claude/agents/tester.md');
    expect(queryAll('ptah-keep-replace-control')).toHaveLength(2);
  });

  it('forces Keep for an unreadable file and the bulk bar skips it', () => {
    create({ preview, snapshot: snapshotOf(preview) });
    const replace = queryAll('[data-testid="replace-segment"]');
    const planner = replace.find((button) =>
      button.getAttribute('aria-label')?.includes('planner.md'),
    );
    expect(planner?.getAttribute('aria-disabled')).toBe('true');
    expect(planner?.tabIndex).toBe(-1);
    expect(dialog().textContent).toContain(
      'Ptah could not compare this file, so it is treated as different and will be kept.',
    );
    expect(query('[data-testid="bulk-decision-bar"]')?.textContent).toContain(
      '1 existing file',
    );
    planner?.click();
    expect(decisions).toEqual([]);
  });

  it('reports a Replace choice and a bulk choice, and counts replacements in the label', () => {
    create({ preview, snapshot: snapshotOf(preview) });
    const backendReplace = queryAll('[data-testid="replace-segment"]').find(
      (button) =>
        button.getAttribute('aria-label')?.includes('backend-developer.md'),
    );
    backendReplace?.click();
    expect(decisions).toEqual([
      { id: 'backend-developer', decision: 'replace' },
    ]);
    query<HTMLButtonElement>('[data-testid="bulk-replace"]')?.click();
    expect(bulk).toEqual(['replace']);

    fixture.componentRef.setInput(
      'snapshot',
      setDecision(snapshotOf(preview), 'backend-developer', 'replace'),
    );
    fixture.detectChanges();
    expect(query('[data-testid="preview-confirm"]')?.textContent?.trim()).toBe(
      'Confirm and generate, replace 1 file',
    );
    expect(query('[data-testid="decision-summary"]')?.textContent).toBe(
      '1 kept, 1 to replace',
    );
  });

  it('labels the writing model and shows the model origin per agent', () => {
    create({ preview, snapshot: snapshotOf(preview), model: 'claude-sonnet-4' });
    expect(words('[data-testid="writing-model"]')).toBe(
      'Writing model: claude-sonnet-4 (writes the content)',
    );
    expect(dialog().textContent).not.toContain('Model: claude-sonnet-4\n');
    expect(query('[data-testid="model-origin-note"]')?.textContent).toContain(
      'opus',
    );
  });

  it('lists rival-CLI files as information only when they were worked out', () => {
    create({ preview, snapshot: snapshotOf(preview) });
    const info = query('[data-testid="info-only-targets"]');
    expect(info?.textContent).toContain('Other CLIs (information only)');
    expect(info?.textContent).toContain('.codex/agents/backend-developer.toml');
    expect(info?.textContent).toContain(
      '(if agent sync is enabled for this agent)',
    );
    expect(info?.querySelector('ptah-keep-replace-control')).toBeNull();
    expect(query('[role="alert"]')).toBeNull();
  });

  it.each([
    [
      'harness-unavailable',
      'Agent sync to other CLIs is not available on this host, so only the Claude agent files are listed.',
    ],
    [
      'cli-detection-failed',
      'Could not check which other CLIs are installed, so only the Claude agent files are listed.',
    ],
  ] as const)(
    'shows the %s warning and no rival rows (R1-5)',
    (rivalStatus, warning) => {
      const value: WizardPreviewGenerationResponse = {
        ...preview,
        rivalStatus,
        warning,
      };
      create({ preview: value, snapshot: snapshotOf(value) });
      expect(query('[role="alert"]')?.textContent?.trim()).toBe(warning);
      expect(dialog().textContent).not.toContain('.codex/agents');
      expect(dialog().textContent).not.toContain('Other CLIs (information only)');
      expect(queryAll('ptah-keep-replace-control')).toHaveLength(2);
    },
  );

  it('shows the target line and reveals the target choice behind Change', () => {
    create({ preview, snapshot: snapshotOf(preview) });
    expect(words('[data-testid="target-line"]')).toBe(
      'Target: D:/work/acme/.claude/agents (project root) Change',
    );
    const change = query<HTMLButtonElement>('[data-testid="target-change"]');
    const panel = query('[data-testid="target-change-panel"]');
    expect(change?.getAttribute('aria-expanded')).toBe('false');
    expect(change?.getAttribute('aria-controls')).toBe(panel?.id);
    expect(panel?.hidden).toBe(true);
    change?.click();
    fixture.detectChanges();
    expect(change?.getAttribute('aria-expanded')).toBe('true');
    expect(panel?.hidden).toBe(false);
    query<HTMLButtonElement>('[data-testid="target-opened"]')?.click();
    expect(targets).toEqual(['opened-folder']);
  });

  it('shows the opened-folder target and the reset status after a target change', () => {
    const opened = {
      ...preview,
      target: { ...target, chosen: 'opened-folder' as const },
    };
    const snapshot = nextSnapshot(
      snapshotOf(preview),
      buildWizardRows(opened),
      'opened-folder',
    );
    create({ preview: opened, snapshot });
    expect(words('[data-testid="target-line"]')).toBe(
      'Target: D:/work/acme/packages/web/.claude/agents (opened folder only) Change',
    );
    expect(query('[data-testid="target-reset-status"]')?.textContent).toContain(
      'every choice is reset to Keep',
    );
  });

  it('hides Change when the opened folder is the project root', () => {
    const same = {
      ...preview,
      target: { ...target, openedIsHarnessRoot: true },
    };
    create({ preview: same, snapshot: snapshotOf(same) });
    expect(query('[data-testid="target-line"]')).not.toBeNull();
    expect(query('[data-testid="target-change"]')).toBeNull();
  });

  it('replaces the list with the checking state and disables confirm while loading', () => {
    create({ preview, snapshot: snapshotOf(preview), loading: true });
    expect(dialog().textContent).toContain('Checking targets...');
    expect(query('[aria-busy="true"]')).not.toBeNull();
    expect(queryAll('ptah-file-decision-row')).toHaveLength(0);
    expect(
      query<HTMLButtonElement>('[data-testid="preview-confirm"]')?.disabled,
    ).toBe(true);
  });

  it('shows the check-failed alert', () => {
    create({ error: true });
    expect(dialog().textContent).toContain(
      'Targets could not be checked. Review the agents folder after generation.',
    );
  });

  it('keeps Tab inside the dialog and skips hidden target buttons and roving radios', () => {
    create({ preview, snapshot: snapshotOf(preview) });
    const change = query<HTMLButtonElement>('[data-testid="target-change"]');
    const confirm = query<HTMLButtonElement>('[data-testid="preview-confirm"]');
    confirm?.focus();
    const forward = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    confirm?.dispatchEvent(forward);
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(change);
    const back = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    change?.dispatchEvent(back);
    expect(document.activeElement).toBe(confirm);

    // The keep segments (checked radios) are tab stops; their Replace
    // siblings and the collapsed target buttons are not.
    const component = fixture.componentInstance as unknown as {
      focusable(): HTMLButtonElement[];
    };
    const stops = component.focusable();
    expect(stops).toContain(change);
    expect(
      stops.some((button) => button.dataset['testid'] === 'target-root'),
    ).toBe(false);
    expect(
      stops.some((button) => button.dataset['testid'] === 'replace-segment'),
    ).toBe(false);
    expect(
      stops.filter((button) => button.dataset['testid'] === 'keep-segment'),
    ).toHaveLength(2);
  });

  it('moves focus into the dialog on open and back to the opener on close', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    create({ preview, snapshot: snapshotOf(preview) });
    await Promise.resolve();
    expect(dialog().contains(document.activeElement)).toBe(true);
    fixture.componentRef.setInput('open', false);
    fixture.detectChanges();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});

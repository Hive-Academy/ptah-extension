import { TestBed } from '@angular/core/testing';
import type { GenerationTargetInfo } from '@ptah-extension/shared';
import { libraryReachable, type OutcomeFileRow } from './outcome-rows';
import { OutcomeSummaryComponent } from './outcome-summary.component';

const harnessRoot: GenerationTargetInfo = {
  harnessRoot: '/ws',
  openedFolder: '/ws',
  chosen: 'harness-root',
  openedIsHarnessRoot: true,
};

const openedFolder: GenerationTargetInfo = {
  harnessRoot: '/ws',
  openedFolder: '/ws/packages/api',
  chosen: 'opened-folder',
  openedIsHarnessRoot: false,
};

/** design-spec 3.9 fixture: 3 written, 2 kept, 1 current, 1 changed. */
const FIXTURE: OutcomeFileRow[] = [
  { id: 'tester', fileName: 'tester.md', status: 'written' },
  { id: 'e2e-tester', fileName: 'e2e-tester.md', status: 'written' },
  {
    id: 'backend-developer',
    fileName: 'backend-developer.md',
    status: 'written',
  },
  {
    id: 'frontend-developer',
    fileName: 'frontend-developer.md',
    status: 'kept',
  },
  { id: 'planner', fileName: 'planner.md', status: 'kept' },
  { id: 'code-reviewer', fileName: 'code-reviewer.md', status: 'unchanged' },
  {
    id: 'data-engineer',
    fileName: 'data-engineer.md',
    status: 'changed-since-preview',
  },
];

interface Inputs {
  rows: readonly OutcomeFileRow[];
  libraryDiverged?: readonly string[];
  target?: GenerationTargetInfo;
  isElectron?: boolean;
  compact?: boolean;
  outputDirectory?: string | null;
}

function render(inputs: Inputs) {
  TestBed.configureTestingModule({ imports: [OutcomeSummaryComponent] });
  const fixture = TestBed.createComponent(OutcomeSummaryComponent);
  fixture.componentRef.setInput('rows', inputs.rows);
  if (inputs.libraryDiverged)
    fixture.componentRef.setInput('libraryDiverged', inputs.libraryDiverged);
  if (inputs.target) fixture.componentRef.setInput('target', inputs.target);
  if (inputs.isElectron !== undefined)
    fixture.componentRef.setInput('isElectron', inputs.isElectron);
  if (inputs.compact !== undefined)
    fixture.componentRef.setInput('compact', inputs.compact);
  if (inputs.outputDirectory !== undefined)
    fixture.componentRef.setInput('outputDirectory', inputs.outputDirectory);
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;
  const counter = (status: string): string | null =>
    root.querySelector(`[data-outcome="${status}"] b`)?.textContent?.trim() ??
    null;
  return { fixture, root, counter };
}

describe('OutcomeSummaryComponent', () => {
  it('shows five counters that add up to the per-file rows', () => {
    const { root, counter } = render({ rows: FIXTURE, target: harnessRoot });
    expect(counter('written')).toBe('3');
    expect(counter('kept')).toBe('2');
    expect(counter('unchanged')).toBe('1');
    expect(counter('changed-since-preview')).toBe('1');
    expect(counter('failed')).toBe('0');
    expect(root.querySelectorAll('[data-outcome]')).toHaveLength(5);
    expect(root.querySelectorAll('li[data-status]')).toHaveLength(7);
    expect(root.querySelector('details')?.hasAttribute('open')).toBe(true);
  });

  it('hides the Failed counter at 0 only at sidebar width', () => {
    const { root, counter } = render({ rows: FIXTURE, compact: true });
    expect(counter('failed')).toBeNull();
    expect(root.querySelectorAll('[data-outcome]')).toHaveLength(4);
    TestBed.resetTestingModule();
    const failed = render({
      rows: [{ id: 'tester', fileName: 'tester.md', status: 'failed' }],
      compact: true,
    });
    expect(failed.counter('failed')).toBe('1');
  });

  it('explains kept, current and changed-since-preview rows', () => {
    const { root } = render({ rows: FIXTURE });
    const note = (status: string): string =>
      root.querySelector(`li[data-status="${status}"]`)?.textContent ?? '';
    expect(note('kept')).toContain(
      'Kept: not regenerated (no content was generated for it).',
    );
    expect(note('unchanged')).toContain(
      'The generated content matched the file on disk.',
    );
    expect(note('changed-since-preview')).toContain(
      'The file changed after you reviewed it',
    );
  });

  it('shows a failure callout with the reason, separate from kept and written', () => {
    const { root } = render({
      rows: [
        {
          id: 'tester',
          fileName: 'tester.md',
          status: 'failed',
          error: 'permission denied',
        },
      ],
    });
    const callout = root.querySelector('[data-testid="outcome-failure"]');
    expect(callout?.getAttribute('role')).toBe('alert');
    expect(callout?.textContent).toContain('.claude/agents/tester.md');
    expect(callout?.textContent).toContain('permission denied');
    expect(callout?.textContent).toContain('not counted as kept or written');
  });

  it.each([
    'write failed: token=sk-live-SECRET at https://internal.example/x?key=abc',
    '<img src=x onerror="alert(1)"><b>boom</b>',
  ])('never renders a raw failure detail %#', (error) => {
    const { root } = render({
      rows: [{ id: 'tester', fileName: 'tester.md', status: 'failed', error }],
    });
    const callout = root.querySelector('[data-testid="outcome-failure"]');
    expect(callout?.textContent).toContain('The write failed.');
    for (const leak of ['sk-live', 'internal.example', 'onerror', 'boom']) {
      expect(callout?.textContent).not.toContain(leak);
      expect(callout?.innerHTML).not.toContain(leak);
    }
    expect(callout?.querySelector('img')).toBeNull();
  });

  it('names only written agents as diverged and never a kept one', () => {
    const { root } = render({
      rows: FIXTURE,
      target: harnessRoot,
      libraryDiverged: ['backend-developer', 'frontend-developer', 'planner'],
    });
    const callout = root.querySelector('[data-testid="outcome-diverged"]');
    expect(callout?.textContent).toContain('1 Library copy now differs');
    expect(callout?.textContent).toContain('backend-developer');
    expect(callout?.textContent).not.toContain('frontend-developer');
    expect(callout?.textContent).not.toContain('planner');
    expect(
      root.querySelector('li[data-status="written"]:nth-child(3)')?.textContent,
    ).toContain('The Library copy now differs from its new source.');
  });

  it('emits openLibrary from the diverged callout', () => {
    const { fixture, root } = render({
      rows: FIXTURE,
      target: harnessRoot,
      libraryDiverged: ['tester'],
    });
    const open = jest.fn();
    fixture.componentInstance.openLibrary.subscribe(open);
    root
      .querySelector<HTMLButtonElement>(
        '[data-testid="outcome-diverged"] button',
      )
      ?.click();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('shows no diverged naming in VS Code, for opened-folder or an unknown target', () => {
    for (const inputs of [
      { isElectron: false, target: harnessRoot },
      { isElectron: true, target: openedFolder },
      { isElectron: true },
    ]) {
      TestBed.resetTestingModule();
      const { root } = render({
        rows: FIXTURE,
        libraryDiverged: ['tester'],
        ...inputs,
      });
      expect(root.querySelector('[data-testid="outcome-diverged"]')).toBeNull();
    }
  });

  it('shows the opened-folder notice per host', () => {
    const electron = render({
      rows: FIXTURE,
      target: openedFolder,
      outputDirectory: '/ws/packages/api/.claude/agents',
    });
    expect(electron.root.textContent).toContain(
      'They will not reach other CLIs and will not appear in the Library.',
    );
    TestBed.resetTestingModule();
    const vscode = render({
      rows: FIXTURE,
      target: openedFolder,
      isElectron: false,
      outputDirectory: '/ws/packages/api/.claude/agents',
    });
    expect(vscode.root.textContent).toContain(
      'They will not reach other CLIs.',
    );
    expect(vscode.root.textContent).not.toContain('Library');
  });
});

describe('libraryReachable', () => {
  it('is true only in Electron for the root the Library reads', () => {
    expect(libraryReachable(true, harnessRoot)).toBe(true);
    expect(libraryReachable(false, harnessRoot)).toBe(false);
    expect(libraryReachable(true, openedFolder)).toBe(false);
    expect(
      libraryReachable(true, { ...openedFolder, openedIsHarnessRoot: true }),
    ).toBe(true);
    expect(libraryReachable(true, undefined)).toBe(false);
  });
});

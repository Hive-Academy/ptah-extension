/**
 * OutputStyleListComponent — the CLI-parity control (B7, plan §4.1/§4.2, R6, E2)
 * plus the two review follow-ups, M1 (shadowed rows) and N1 (E5 banner copy).
 *
 * The list has plenty of other behaviour, but only these carry a risk worth a
 * spec. Each claim below is the difference between the UI being honest and the
 * UI merely looking right:
 *
 *   1. The box starts UNTICKED, and a selection made while it is unticked emits
 *      **no `parity` field at all** — not `{ enabled: false }`. The absent field
 *      is what stops the backend from ever reaching its settings writer, so it
 *      is the thing worth pinning.
 *   2. The exact file is named BEFORE anything is written, and it changes with
 *      the tier — the user is never asked to trust an unnamed write (R6).
 *   3. Nothing rendered here is an absolute host path (Req 7.6).
 *   4. **M1** — a shadowed row's control is DISABLED and carries its reason.
 *      Clicking it would have activated the winning entry, checkmarking a
 *      different row from the one clicked. The reason names the winner.
 *   5. **N1** — the missing-active banner is accurate for BOTH causes of
 *      `missing: true`. It may only claim removal when the invalid list is
 *      empty, because a parse failure would have put the file in that list.
 */

import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type {
  ActiveOutputStyleState,
  InvalidOutputStyle,
  OutputStyleEntry,
} from '@ptah-extension/shared';
import {
  OutputStyleListComponent,
  type OutputStyleSelectionRequest,
} from './output-style-list.component';

const BUILT_IN_DEFAULT: OutputStyleEntry = {
  name: 'default',
  tier: 'builtin',
  description: 'The agent behaves exactly as it does with no style chosen.',
  keepCodingInstructions: true,
  editable: false,
  deletable: false,
  immutableReason: 'built-in',
};

const USER_STYLE: OutputStyleEntry = {
  name: 'Terse',
  tier: 'user',
  description: 'Fewer words.',
  keepCodingInstructions: true,
  editable: true,
  deletable: true,
  fileName: 'terse.md',
  relativePath: '~/.claude/output-styles/terse.md',
};

const NO_SELECTION: ActiveOutputStyleState = {
  name: null,
  tier: null,
  missing: false,
};

/** Host so the required inputs are bound the way the config shell binds them. */
@Component({
  standalone: true,
  imports: [OutputStyleListComponent],
  template: `
    <ptah-output-style-list
      [styles]="styles()"
      [invalid]="invalid()"
      [active]="active()"
      [parityWrittenPath]="parityWrittenPath()"
      [parityWarning]="parityWarning()"
      (activate)="emitted.push($event)"
    />
  `,
})
class HostComponent {
  readonly styles = signal<readonly OutputStyleEntry[]>([
    BUILT_IN_DEFAULT,
    USER_STYLE,
  ]);
  readonly invalid = signal<readonly InvalidOutputStyle[]>([]);
  readonly active = signal<ActiveOutputStyleState>(NO_SELECTION);
  readonly parityWrittenPath = signal<string | null>(null);
  readonly parityWarning = signal<string | null>(null);
  readonly emitted: OutputStyleSelectionRequest[] = [];
}

describe('OutputStyleListComponent — CLI parity control', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  function list(): OutputStyleListComponent {
    return fixture.debugElement.children[0]
      .componentInstance as OutputStyleListComponent;
  }

  function text(): string {
    return fixture.nativeElement.textContent ?? '';
  }

  /** The style row buttons carry `role="radio"`; index 1 is the user style. */
  function clickStyleRow(index: number): void {
    const rows: HTMLButtonElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('button[role="radio"]'),
    );
    rows[index].click();
    fixture.detectChanges();
  }

  function parityCheckbox(): HTMLInputElement {
    return fixture.nativeElement.querySelector('input[type="checkbox"]');
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('starts unticked and emits no parity field at all (default OFF)', () => {
    expect(list().parityEnabled()).toBe(false);
    expect(parityCheckbox().checked).toBe(false);

    clickStyleRow(1);

    expect(host.emitted).toEqual([{ name: 'Terse' }]);
    expect('parity' in host.emitted[0]).toBe(false);
  });

  it('emits the opt-in request once the box is ticked', () => {
    parityCheckbox().click();
    fixture.detectChanges();

    clickStyleRow(1);

    expect(host.emitted).toEqual([
      { name: 'Terse', parity: { enabled: true, tier: 'project' } },
    ]);
  });

  it('defaults to the committable project tier (§4.2)', () => {
    expect(list().parityTier()).toBe('project');
    expect(list().parityDisplayPath()).toBe('.claude/settings.json');
  });

  it('names the exact file before anything is written (R6, E2)', () => {
    expect(text()).toContain('.claude/settings.json');

    list().parityTier.set('local');
    fixture.detectChanges();
    expect(list().parityDisplayPath()).toBe('.claude/settings.local.json');

    list().parityTier.set('user');
    fixture.detectChanges();
    expect(list().parityDisplayPath()).toBe('~/.claude/settings.json');
  });

  it('switches tier from the select and keeps the named file in step', () => {
    parityCheckbox().click();
    fixture.detectChanges();

    const select: HTMLSelectElement = fixture.nativeElement.querySelector(
      '#output-style-parity-tier',
    );
    select.value = 'local';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(list().parityTier()).toBe('local');

    clickStyleRow(1);
    expect(host.emitted).toEqual([
      { name: 'Terse', parity: { enabled: true, tier: 'local' } },
    ]);
  });

  it('reports a parity failure as a warning that keeps the style active', () => {
    host.parityWarning.set(
      '.claude/settings.json is not valid JSON. Ptah did not change it.',
    );
    fixture.detectChanges();

    expect(text()).toContain('Ptah did not change it.');
    expect(text()).toContain('still active in Ptah');
    // A warning, not the error banner — that one is `role="alert"`.
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });

  it('confirms the written file by name on success', () => {
    host.parityWrittenPath.set('.claude/settings.local.json');
    fixture.detectChanges();

    expect(text()).toContain('Saved to');
    expect(text()).toContain('.claude/settings.local.json');
  });

  it('renders no absolute host path anywhere (Req 7.6)', () => {
    parityCheckbox().click();
    host.parityWrittenPath.set('~/.claude/settings.json');
    fixture.detectChanges();

    expect(text()).not.toMatch(/[A-Za-z]:[\\/]/);
  });
});

/**
 * M1 — a losing row must not offer an action whose visible result lands
 * somewhere else.
 */
describe('OutputStyleListComponent — shadowed rows (E4/M1)', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const PROJECT_WINNER: OutputStyleEntry = {
    name: 'Learning',
    tier: 'project',
    description: 'Explains as it goes.',
    keepCodingInstructions: true,
    editable: true,
    deletable: true,
    fileName: 'learning.md',
    relativePath: '.claude/output-styles/learning.md',
  };

  const USER_LOSER: OutputStyleEntry = {
    ...PROJECT_WINNER,
    tier: 'user',
    relativePath: '~/.claude/output-styles/learning.md',
    shadowed: true,
  };

  function rows(): HTMLButtonElement[] {
    return Array.from(
      fixture.nativeElement.querySelectorAll('button[role="radio"]'),
    );
  }

  /** Index 1 is the project winner, index 2 the shadowed user copy. */
  function winnerRow(): HTMLButtonElement {
    return rows()[1];
  }
  function shadowedRow(): HTMLButtonElement {
    return rows()[2];
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    host.styles.set([BUILT_IN_DEFAULT, PROJECT_WINNER, USER_LOSER]);
    host.active.set({ name: 'Learning', tier: 'project', missing: false });
    fixture.detectChanges();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('disables the shadowed row and leaves the winner selectable', () => {
    expect(shadowedRow().disabled).toBe(true);
    expect(winnerRow().disabled).toBe(false);
  });

  it('carries the reason on the control and as visible text', () => {
    const reason =
      "Selecting this name activates this project's copy of the same name, " +
      'which outranks this file, so this row cannot be chosen on its own. ' +
      'Rename this file to make it selectable.';

    expect(shadowedRow().getAttribute('title')).toBe(reason);
    expect(fixture.nativeElement.textContent).toContain(reason);
    // Req 4.2's shape: disabled WITH a reason, never a row that quietly vanishes.
    expect(winnerRow().getAttribute('title')).toBeNull();
  });

  it('points aria-describedby at the element actually holding the reason', () => {
    const id = shadowedRow().getAttribute('aria-describedby');
    expect(id).toBeTruthy();

    const described = fixture.nativeElement.querySelector(`[id="${id}"]`);
    expect(described).not.toBeNull();
    expect(described.textContent).toContain('which outranks this file');
    expect(winnerRow().getAttribute('aria-describedby')).toBeNull();
  });

  it('names the winning tier rather than a generic "another file"', () => {
    expect(fixture.nativeElement.textContent).toContain(
      "this project's copy of the same name",
    );

    // Flip the merge outcome: now the user copy wins and the project one loses.
    host.styles.set([
      BUILT_IN_DEFAULT,
      { ...PROJECT_WINNER, shadowed: true },
      { ...USER_LOSER, shadowed: false },
    ]);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'your own copy of the same name',
    );
  });

  it('emits nothing when the shadowed row is clicked', () => {
    shadowedRow().click();
    fixture.detectChanges();

    expect(host.emitted).toEqual([]);
  });

  it('keeps radiogroup semantics: the winner is checked, the loser is not', () => {
    expect(winnerRow().getAttribute('aria-checked')).toBe('true');
    expect(shadowedRow().getAttribute('aria-checked')).toBe('false');
    expect(
      fixture.nativeElement.querySelector('[role="radiogroup"]'),
    ).not.toBeNull();
  });

  it('still renders the never-colour-alone Overridden badge', () => {
    expect(fixture.nativeElement.textContent).toContain('Overridden');
  });
});

/**
 * N1 — `missing: true` has two causes and the banner may only name the one the
 * list can corroborate.
 */
describe('OutputStyleListComponent — missing active style (E5/N1)', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const BROKEN_FILE: InvalidOutputStyle = {
    fileName: 'learning.md',
    relativePath: '~/.claude/output-styles/learning.md',
    tier: 'user',
    error: {
      code: 'YAML_PARSE',
      line: 2,
      message: 'The frontmatter is not valid YAML (line 2).',
    },
    openable: true,
  };

  function banner(): HTMLElement {
    return fixture.nativeElement.querySelector('[role="status"]');
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    host.active.set({ name: 'Learning', tier: null, missing: true });
    fixture.detectChanges();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('names removal only when no file failed to parse', () => {
    expect(host.invalid()).toEqual([]);
    expect(banner().textContent).toContain(
      'is no longer available. Its file was removed or renamed outside Ptah, ' +
        'so new sessions run with the default behaviour.',
    );
    expect(banner().textContent).toContain('Learning');
  });

  it('does not claim removal once a file could not be read', () => {
    host.invalid.set([BROKEN_FILE]);
    fixture.detectChanges();

    const copy = banner().textContent ?? '';

    // The parse-failure cause is offered alongside removal, never instead of it.
    expect(copy).toContain(
      'is no longer available. Its file was either removed outside Ptah, or ' +
        'it is one of the files Ptah could not read, listed below — repairing ' +
        'that file brings the style back. Until then, new sessions run with ' +
        'the default behaviour.',
    );
    // The unconditional removal claim is gone — the file may well still exist.
    expect(copy).not.toContain('was removed or renamed outside Ptah');
    expect(copy).not.toContain('no longer exists');
  });

  it('points at a list that is actually on screen when it blames parsing', () => {
    host.invalid.set([BROKEN_FILE]);
    fixture.detectChanges();

    const page = fixture.nativeElement.textContent ?? '';
    expect(page).toContain('Files Ptah could not read');
    expect(page).toContain('Rewrite it here');
  });

  it('keeps the banner a status with a working escape hatch', () => {
    expect(banner()).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();

    const clear: HTMLButtonElement = Array.from<HTMLButtonElement>(
      fixture.nativeElement.querySelectorAll('button'),
    ).find((button) =>
      (button.textContent ?? '').includes('Clear the selection'),
    ) as HTMLButtonElement;

    clear.click();
    fixture.detectChanges();
    expect(host.emitted).toEqual([{ name: null }]);
  });

  it('shows no banner at all while the selection resolves', () => {
    host.active.set(NO_SELECTION);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain(
      'is no longer available',
    );
  });
});

/**
 * OutputStyleListComponent specs.
 *
 * Covers:
 *   1. P4 matrix table with radio column and `role="radiogroup"` (G7, A19).
 *   2. CLI parity in `<details>` (P9, A24) with S-confirm before file write and no Undo.
 *   3. M1 — shadowed rows are disabled with reason naming the winner (E4/M1).
 *   4. N1 — missing-active banner names both causes unless invalid list is empty (E5/N1).
 *   5. D15 fixed error copy — never surfaces host error text in alert banner.
 */

import { Component, signal, ChangeDetectionStrategy } from '@angular/core';
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
import type { OutputStyleFailedOperation } from './output-style.store';

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
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <ptah-output-style-list
      [styles]="styles()"
      [invalid]="invalid()"
      [active]="active()"
      [failedOperation]="failedOperation()"
      [parityWrittenPath]="parityWrittenPath()"
      [parityWarning]="parityWarning()"
      [usingFallback]="usingFallback()"
      (activate)="emitted.push($event)"
      (copyToProject)="copies.push($event)"
    />
  `,
})
class HostComponent {
  readonly usingFallback = signal(false);
  readonly copies: { readonly name: string; readonly overwrite: boolean }[] = [];
  readonly styles = signal<readonly OutputStyleEntry[]>([
    BUILT_IN_DEFAULT,
    USER_STYLE,
  ]);
  readonly invalid = signal<readonly InvalidOutputStyle[]>([]);
  readonly active = signal<ActiveOutputStyleState>(NO_SELECTION);
  readonly failedOperation = signal<OutputStyleFailedOperation | null>(null);
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

  /** The style row radios carry `role="radio"`; index 1 is the user style. */
  function clickStyleRow(index: number): void {
    const rows: HTMLElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('[role="radio"]'),
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

  it('renders a P4 matrix table with role="radiogroup"', () => {
    const table = fixture.nativeElement.querySelector('table[role="radiogroup"]');
    expect(table).not.toBeNull();
    expect(table.classList).toContain('table-xs');
    expect(text()).toContain('Active');
    expect(text()).toContain('Name');
    expect(text()).toContain('Tier');
    expect(text()).toContain('Description');
    expect(text()).toContain('Actions');
  });

  it('starts unticked and emits no parity field at all (default OFF)', () => {
    expect(list().parityEnabled()).toBe(false);
    expect(parityCheckbox().checked).toBe(false);

    clickStyleRow(1);

    expect(host.emitted).toEqual([{ name: 'Terse' }]);
    expect('parity' in host.emitted[0]).toBe(false);
  });

  it('asks for confirmation before emitting when parity is ticked (S-confirm, A24)', () => {
    parityCheckbox().click();
    fixture.detectChanges();

    clickStyleRow(1);

    // Confirmation dialog is shown; selection not yet emitted
    expect(host.emitted).toEqual([]);
    const confirmBlock = fixture.nativeElement.querySelector(
      '[data-testid="parity-confirm"]',
    );
    expect(confirmBlock).not.toBeNull();
    expect(confirmBlock.textContent).toContain('.claude/settings.json');

    // Confirm the write
    const confirmBtn: HTMLButtonElement = fixture.nativeElement.querySelector(
      '[data-testid="parity-confirm-button"]',
    );
    confirmBtn.click();
    fixture.detectChanges();

    expect(host.emitted).toEqual([
      { name: 'Terse', parity: { enabled: true, tier: 'project' } },
    ]);
  });

  it('cancels the parity selection without emitting when Cancel is clicked', () => {
    parityCheckbox().click();
    fixture.detectChanges();

    clickStyleRow(1);

    const cancelBtn: HTMLButtonElement = fixture.nativeElement.querySelector(
      '[data-testid="parity-cancel-button"]',
    );
    expect(cancelBtn).not.toBeNull();
    cancelBtn.click();
    fixture.detectChanges();

    expect(host.emitted).toEqual([]);
    expect(
      fixture.nativeElement.querySelector('[data-testid="parity-confirm"]'),
    ).toBeNull();
  });

  function radios(): HTMLInputElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('input[name="active-output-style"]'));
  }

  it('puts the radio back on the saved style when the parity confirm is cancelled (Batch 49b)', () => {
    parityCheckbox().click();
    fixture.detectChanges();
    clickStyleRow(1);
    expect(radios()[1].checked).toBe(true);

    (fixture.nativeElement.querySelector('[data-testid="parity-cancel-button"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(radios().map((radio) => radio.checked)).toEqual([true, false]);
  });

  it('syncActiveRadios shows the saved style again after a refused activate (D15, Batch 49b)', () => {
    clickStyleRow(1);
    expect(host.emitted).toEqual([{ name: 'Terse' }]);
    // The write failed: `active` never changed, so the [checked] bindings did not either.
    expect(radios()[1].checked).toBe(true);

    list().syncActiveRadios();
    expect(radios().map((radio) => radio.checked)).toEqual([true, false]);

    list().syncActiveRadios('Terse');
    expect(radios().map((radio) => radio.checked)).toEqual([false, true]);
  });

  describe('delete confirm (P8, Batch 49b)', () => {
    const deleteButton = (): HTMLButtonElement =>
      fixture.nativeElement.querySelectorAll('[data-testid="output-style-delete-button"]')[1];
    const confirm = (): HTMLElement | null =>
      fixture.nativeElement.querySelector('[data-testid="output-style-delete-confirm"]');

    beforeEach(() => document.body.appendChild(fixture.nativeElement));
    afterEach(() => fixture.nativeElement.remove());

    it('opens with Cancel focused; Esc cancels, returns focus to Delete and stops there', () => {
      const outer = jest.fn();
      document.body.addEventListener('keydown', outer);
      try {
        deleteButton().click();
        fixture.detectChanges();
        expect(confirm()).not.toBeNull();
        expect(document.activeElement?.textContent?.trim()).toBe('Cancel');

        document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        fixture.detectChanges();

        expect(confirm()).toBeNull();
        expect(document.activeElement).toBe(deleteButton());
        expect(outer).not.toHaveBeenCalled();
      } finally {
        document.body.removeEventListener('keydown', outer);
      }
    });

    it('Cancel closes the confirm and returns focus to Delete', () => {
      deleteButton().click();
      fixture.detectChanges();
      (document.activeElement as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(confirm()).toBeNull();
      expect(document.activeElement).toBe(deleteButton());
    });
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
    const confirmBtn: HTMLButtonElement = fixture.nativeElement.querySelector(
      '[data-testid="parity-confirm-button"]',
    );
    confirmBtn.click();
    fixture.detectChanges();

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
    // 12 px minimum: no 10-11 px helper text left anywhere in the list, its banners or the parity section.
    expect(fixture.nativeElement.querySelector('[class*="text-[10px]"], [class*="text-[11px]"]')).toBeNull();
    const body = fixture.nativeElement.querySelector('[data-testid="output-style-parity-warning"] p') as HTMLElement;
    expect(body.classList).toContain('text-xs');
    expect(body.classList).toContain('text-base-content');
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

  it.each<[OutputStyleFailedOperation, string]>([
    ['list', 'Could not read the output styles.'],
    ['activate', 'Could not change the active output style.'],
    ['save', 'Could not save the output style.'],
    ['delete', 'Could not delete the output style.'],
    ['open', 'Could not open that output style.'],
    ['copy', 'Could not copy the output style to the project.'],
  ])('names the failed %s operation with its fixed sentence in role="alert" (Moderate 4, D15)', (operation, sentence) => {
    host.failedOperation.set(operation);
    fixture.detectChanges();

    const alert = fixture.nativeElement.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(sentence);
  });

  describe('same-selection guard (Moderate 6)', () => {
    it('clicking the already-active radio emits nothing', () => {
      clickStyleRow(0);
      expect(host.emitted).toEqual([]);
      expect(radios()[0].checked).toBe(true);
    });

    it('with parity ticked, the active radio asks once for the file write, then does nothing', () => {
      parityCheckbox().click();
      fixture.detectChanges();

      clickStyleRow(0);
      expect(fixture.nativeElement.querySelector('[data-testid="parity-confirm"]')).not.toBeNull();
      (fixture.nativeElement.querySelector('[data-testid="parity-confirm-button"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(host.emitted).toEqual([{ name: null, parity: { enabled: true, tier: 'project' } }]);
      // The config reports the activation succeeded.
      list().parityActivated('project');

      clickStyleRow(0);
      expect(host.emitted).toHaveLength(1);
      expect(fixture.nativeElement.querySelector('[data-testid="parity-confirm"]')).toBeNull();
    });

    it('a failed activation does not count the parity file as written: the next click asks again (N3)', () => {
      parityCheckbox().click();
      fixture.detectChanges();

      clickStyleRow(0);
      (fixture.nativeElement.querySelector('[data-testid="parity-confirm-button"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(host.emitted).toHaveLength(1);
      // No parityActivated call: the activation failed.

      clickStyleRow(0);
      expect(fixture.nativeElement.querySelector('[data-testid="parity-confirm"]')).not.toBeNull();
    });
  });

  describe('copy to this project (review item 16)', () => {
    const PROJECT_TERSE: OutputStyleEntry = { ...USER_STYLE, tier: 'project', relativePath: '.claude/output-styles/terse.md' };
    const copyButton = (): HTMLButtonElement =>
      fixture.nativeElement.querySelector('[data-testid="output-style-copy-to-project"]');
    const confirm = (): HTMLElement | null =>
      fixture.nativeElement.querySelector('[data-testid="output-style-copy-confirm"]');

    beforeEach(() => {
      document.body.appendChild(fixture.nativeElement);
      host.usingFallback.set(true);
      host.active.set({ name: 'Terse', tier: 'user', missing: false });
      fixture.detectChanges();
    });
    afterEach(() => fixture.nativeElement.remove());

    it('copies straight away, without overwrite, when the project has no style of that name', () => {
      copyButton().click();
      fixture.detectChanges();

      expect(confirm()).toBeNull();
      expect(host.copies).toEqual([{ name: 'Terse', overwrite: false }]);
    });

    it('asks first when a project style of that name exists; Replace it copies with overwrite, no Undo', () => {
      host.styles.set([BUILT_IN_DEFAULT, PROJECT_TERSE, { ...USER_STYLE, shadowed: true }]);
      fixture.detectChanges();

      copyButton().click();
      fixture.detectChanges();
      expect(host.copies).toEqual([]);
      expect(confirm()?.getAttribute('role')).toBe('alertdialog');
      expect(document.activeElement?.textContent?.trim()).toBe('Cancel');
      const replace = fixture.nativeElement.querySelector('[data-testid="output-style-confirm-copy"]') as HTMLButtonElement;
      expect(replace.className).toContain('btn-outline');
      expect(replace.className).toContain('border-error');
      expect(replace.className).toContain('text-base-content');

      replace.click();
      fixture.detectChanges();
      expect(confirm()).toBeNull();
      expect(host.copies).toEqual([{ name: 'Terse', overwrite: true }]);
      expect(text()).not.toContain('Undo');
    });

    it('Esc closes only the confirm, returns focus to Copy and stops there; nothing is copied', () => {
      host.styles.set([BUILT_IN_DEFAULT, PROJECT_TERSE]);
      fixture.detectChanges();
      const outer = jest.fn();
      document.body.addEventListener('keydown', outer);
      try {
        copyButton().click();
        fixture.detectChanges();
        document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        fixture.detectChanges();

        expect(confirm()).toBeNull();
        expect(document.activeElement).toBe(copyButton());
        expect(outer).not.toHaveBeenCalled();
        expect(host.copies).toEqual([]);
      } finally {
        document.body.removeEventListener('keydown', outer);
      }
    });
  });

  describe('parity section visibility and dismissal (Serious 2, Moderate 7)', () => {
    const details = (): HTMLDetailsElement =>
      fixture.nativeElement.querySelector('[data-testid="output-style-parity-details"]');

    beforeEach(() => document.body.appendChild(fixture.nativeElement));
    afterEach(() => fixture.nativeElement.remove());

    it('opens the collapsed section when a confirm is pending, with Cancel focused', () => {
      parityCheckbox().click();
      fixture.detectChanges();
      details().open = false;

      clickStyleRow(1);

      expect(details().open).toBe(true);
      expect(document.activeElement?.getAttribute('data-testid')).toBe('parity-cancel-button');
    });

    it('collapsing the section with a pending confirm cancels it and puts the radios back', () => {
      parityCheckbox().click();
      fixture.detectChanges();
      clickStyleRow(1);
      expect(radios()[1].checked).toBe(true);

      details().open = false;
      details().dispatchEvent(new Event('toggle'));
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('[data-testid="parity-confirm"]')).toBeNull();
      expect(radios().map((radio) => radio.checked)).toEqual([true, false]);
      expect(host.emitted).toEqual([]);
    });

    it('Esc on the confirm cancels it, stops there and focuses the saved radio', () => {
      const outer = jest.fn();
      document.body.addEventListener('keydown', outer);
      try {
        parityCheckbox().click();
        fixture.detectChanges();
        clickStyleRow(1);

        document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('[data-testid="parity-confirm"]')).toBeNull();
        expect(outer).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(radios()[0]);
        expect(host.emitted).toEqual([]);
      } finally {
        document.body.removeEventListener('keydown', outer);
      }
    });

    it('opens the collapsed section when a parity warning arrives', () => {
      details().open = false;
      host.parityWarning.set('.claude/settings.json is not a valid settings file.');
      fixture.detectChanges();

      expect(details().open).toBe(true);
    });

    it('uses the outline confirm button, not a solid warning fill (m3)', () => {
      parityCheckbox().click();
      fixture.detectChanges();
      clickStyleRow(1);
      const button = fixture.nativeElement.querySelector('[data-testid="parity-confirm-button"]') as HTMLElement;
      expect(button.classList).toContain('btn-outline');
      expect(button.classList).not.toContain('btn-warning');
    });
  });

  describe('delete confirm shape (D5) and built-in note (M4)', () => {
    it('renders the delete confirm in its own full-width row with an outline button', () => {
      (fixture.nativeElement.querySelectorAll('[data-testid="output-style-delete-button"]')[1] as HTMLButtonElement).click();
      fixture.detectChanges();

      const confirm = fixture.nativeElement.querySelector('[data-testid="output-style-delete-confirm"]') as HTMLElement;
      const cell = confirm.closest('td') as HTMLTableCellElement;
      expect(cell.getAttribute('colspan')).toBe('5');
      expect(cell.closest('tr')?.getAttribute('data-testid')).toBeNull();
      expect(confirm.className).not.toMatch(/bg-error|border-error/);
      const button = fixture.nativeElement.querySelector('[data-testid="output-style-confirm-delete"]') as HTMLElement;
      expect(button.classList).toContain('btn-outline');
      expect(button.classList).not.toContain('btn-error');
    });

    it('states the built-in note once, as the badge tooltip and one footnote, not per row', () => {
      host.styles.set([BUILT_IN_DEFAULT, { ...BUILT_IN_DEFAULT, name: 'Explanatory' }, USER_STYLE]);
      fixture.detectChanges();

      const note = 'Built into the agent — Ptah can select it but not change it.';
      expect((text().match(/Ptah can select it but not change it/g) ?? []).length).toBe(0);
      expect(fixture.nativeElement.querySelectorAll('[data-testid="output-style-builtin-note"]')).toHaveLength(1);
      const badges = Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('.badge')).filter(
        (badge) => badge.textContent?.trim() === 'Built-in',
      );
      expect(badges).toHaveLength(2);
      expect(badges.every((badge) => badge.getAttribute('title') === note)).toBe(true);
    });
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

  function rows(): (HTMLInputElement | HTMLButtonElement)[] {
    return Array.from(
      fixture.nativeElement.querySelectorAll('[role="radio"]'),
    );
  }

  /** Index 1 is the project winner, index 2 the shadowed user copy. */
  function winnerRow(): HTMLInputElement | HTMLButtonElement {
    return rows()[1];
  }
  function shadowedRow(): HTMLInputElement | HTMLButtonElement {
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

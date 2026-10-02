import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { TurnChangeSet, TurnChangeSetFile } from '@ptah-extension/shared';
import {
  ChangeSetCardComponent,
  changeSetAccent,
  formatFileCounts,
  type ChangeSetCardHost,
} from './change-set-card.component';

function file(
  overrides: Partial<TurnChangeSetFile> & { path: string },
): TurnChangeSetFile {
  return { status: 'M', additions: 1, deletions: 1, ...overrides };
}

function changeSet(overrides: Partial<TurnChangeSet> = {}): TurnChangeSet {
  return {
    sessionId: 's1',
    workspaceRoot: '/repo',
    turnStartedAt: 1,
    turnEndedAt: 2,
    files: [
      file({ path: 'src/app.ts', additions: 12, deletions: 3 }),
      file({
        path: 'src/new-file.ts',
        status: 'A',
        additions: 40,
        deletions: 0,
      }),
      file({ path: 'src/old.ts', status: 'D', additions: 0, deletions: 39 }),
      file({
        path: 'src/moved.ts',
        origPath: 'src/orig.ts',
        status: 'R',
        additions: 2,
        deletions: 0,
      }),
    ],
    truncatedCount: 0,
    totals: { files: 4, additions: 54, deletions: 42 },
    countsUnavailable: false,
    ...overrides,
  };
}

describe('formatFileCounts', () => {
  it.each([
    [{ additions: 12, deletions: 3 }, false, '+12 −3'],
    [{ additions: 40, deletions: 0 }, false, '+40'],
    [{ additions: 0, deletions: 39 }, false, '−39'],
    [{ additions: 0, deletions: 0 }, false, '+0 −0'],
    [{ additions: null, deletions: 3 }, false, '?'],
    [{ additions: 12, deletions: 3 }, true, '?'],
    [{ additions: null, deletions: null, binary: true }, false, 'binary'],
    [{ additions: null, deletions: null, binary: true }, true, 'binary'],
  ])('formats %p (unavailable=%p) as %p', (counts, unavailable, expected) => {
    expect(formatFileCounts(file({ path: 'a', ...counts }), unavailable)).toBe(
      expected,
    );
  });
});

describe('changeSetAccent', () => {
  it.each([
    [{ additions: 100, deletions: 10 }, false, 'oklch(var(--su))'],
    [{ additions: 10, deletions: 100 }, false, 'oklch(var(--er))'],
    [{ additions: 50, deletions: 50 }, false, 'oklch(var(--wa))'],
    [{ additions: 0, deletions: 0 }, false, 'oklch(var(--bcm, var(--bc)))'],
    [{ additions: 100, deletions: 0 }, true, 'oklch(var(--bcm, var(--bc)))'],
  ])('maps %p (unavailable=%p) to %p', (totals, unavailable, expected) => {
    expect(
      changeSetAccent(
        changeSet({
          totals: { files: 1, ...totals },
          countsUnavailable: unavailable,
        }),
      ),
    ).toBe(expected);
  });
});

describe('ChangeSetCardComponent', () => {
  let fixture: ComponentFixture<ChangeSetCardComponent>;

  const queryAll = (sel: string): HTMLElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll(sel));
  const query = (sel: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(sel);
  function el(sel: string): HTMLElement {
    const found = query(sel);
    if (!found) throw new Error(`Expected element for selector ${sel}`);
    return found;
  }
  const text = (node: Element): string =>
    (node.textContent ?? '').replace(/\s+/g, ' ').trim();

  function render(
    set: TurnChangeSet,
    options: {
      host?: ChangeSetCardHost;
      reconciled?: ReadonlySet<string>;
      conflicted?: ReadonlySet<string>;
    } = {},
  ): void {
    fixture.componentRef.setInput('changeSet', set);
    fixture.componentRef.setInput('host', options.host ?? 'electron');
    if (options.reconciled) {
      fixture.componentRef.setInput('reconciled', options.reconciled);
    }
    if (options.conflicted) {
      fixture.componentRef.setInput('conflicted', options.conflicted);
    }
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ChangeSetCardComponent] });
    fixture = TestBed.createComponent(ChangeSetCardComponent);
  });

  it('renders the header, totals and one button row per file', () => {
    render(changeSet());

    expect(text(el('[data-testid="change-set-files"]'))).toBe(
      '4 files changed',
    );
    const totals = el('[data-testid="change-set-totals"]');
    expect(text(el('.diff-add-text'))).toBe('+54');
    expect(text(el('.diff-del-text'))).toBe('−42');
    // Angular drops the whitespace between the two spans; the gap is layout.
    expect(totals.className).toContain('gap-1');
    const rows = queryAll('[data-testid="change-set-row"]');
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.tagName).toBe('BUTTON');
      expect(row.getAttribute('type')).toBe('button');
      expect(row.querySelector('button, a, input, [tabindex]')).toBeNull();
      // The global 2 px focus outline (>= 3:1 in both anubis themes) stays
      // on, drawn inset, with a tint as a second cue.
      expect(row.className).not.toContain('focus-visible:outline-none');
      expect(row.className).not.toContain('ring-primary');
      expect(row.className).toContain('focus-visible:-outline-offset-2');
      expect(row.className).toContain('focus-visible:bg-base-300/50');
    }
    expect(queryAll('[data-testid="change-set-row-counts"]').map(text)).toEqual(
      ['+12 −3', '+40', '−39', '+2'],
    );
    expect(queryAll('[data-testid="file-status-badge"]').map(text)).toEqual([
      'M',
      'A',
      'D',
      'R',
    ]);
  });

  it('names the rename source for assistive technology', () => {
    render(changeSet());
    const renamed = queryAll('[data-testid="change-set-row"]')[3];
    expect(text(renamed)).toContain('src/moved.ts renamed from');
    expect(text(renamed)).toContain('src/orig.ts');
  });

  it('labels the primary action per host and shows Source Control only in VS Code', () => {
    render(changeSet(), { host: 'electron' });
    expect(text(el('[data-testid="change-set-review"]'))).toBe('Review');
    expect(query('[data-testid="change-set-open-scm"]')).toBeNull();

    fixture.componentRef.setInput('host', 'vscode');
    fixture.detectChanges();
    expect(text(el('[data-testid="change-set-review"]'))).toBe('Review all');
    expect(query('[data-testid="change-set-open-scm"]')).not.toBeNull();
  });

  it('emits review, openFile and openScm', () => {
    render(changeSet(), { host: 'vscode' });
    const review = jest.fn();
    const openFile = jest.fn();
    const openScm = jest.fn();
    fixture.componentInstance.review.subscribe(review);
    fixture.componentInstance.openFile.subscribe(openFile);
    fixture.componentInstance.openScm.subscribe(openScm);

    el('[data-testid="change-set-review"]').click();
    queryAll('[data-testid="change-set-row"]')[2].click();
    el('[data-testid="change-set-open-scm"]').click();

    expect(review).toHaveBeenCalledTimes(1);
    expect(openFile).toHaveBeenCalledWith('src/old.ts');
    expect(openScm).toHaveBeenCalledTimes(1);
  });

  it('never renders zeros when counts are unavailable', () => {
    render(
      changeSet({
        countsUnavailable: true,
        totals: { files: 4, additions: 0, deletions: 0 },
        files: [file({ path: 'src/app.ts', additions: null, deletions: null })],
      }),
    );

    expect(query('[data-testid="change-set-totals"]')).toBeNull();
    expect(text(el('[data-testid="change-set-counts-unavailable"]'))).toBe(
      'counts unavailable',
    );
    expect(text(el('[data-testid="change-set-row-counts"]'))).toBe('?');
    expect(text(el('[data-testid="change-set-card"]'))).not.toMatch(/[+−]0\b/);
  });

  it('shows a reconciled file as non-interactive "No longer changes HEAD"', () => {
    const openFile = jest.fn();
    render(changeSet(), { reconciled: new Set(['src/app.ts']) });
    fixture.componentInstance.openFile.subscribe(openFile);

    const reconciled = el('[data-testid="change-set-row-reconciled"]');
    expect(reconciled.tagName).toBe('DIV');
    expect(text(reconciled)).toContain('No longer changes HEAD');
    expect(text(reconciled)).not.toContain('+12');
    expect(reconciled.querySelector('button')).toBeNull();
    reconciled.click();
    expect(openFile).not.toHaveBeenCalled();
    expect(queryAll('[data-testid="change-set-row"]')).toHaveLength(3);
  });

  it('marks a conflicted file and keeps it actionable, ahead of reconciled', () => {
    render(changeSet(), {
      host: 'vscode',
      conflicted: new Set(['src/app.ts']),
      reconciled: new Set(['src/app.ts']),
    });

    const row = queryAll('[data-testid="change-set-row"]')[0];
    expect(text(row)).toContain('Conflicted');
    expect(
      row.querySelector('[data-testid="change-set-row-conflicted"]')?.className,
    ).toContain('err-solid-text');
    expect(
      row
        .querySelector('[data-testid="file-status-badge"]')
        ?.getAttribute('aria-label'),
    ).toBe('Conflicted');
    expect(row.getAttribute('title')).toContain('merge editor');
    expect(query('[data-testid="change-set-row-reconciled"]')).toBeNull();
  });

  it('reconciles a file recorded as U once the marks say its conflict is gone', () => {
    const resolved = file({
      path: 'src/merged.ts',
      status: 'U',
      additions: null,
      deletions: null,
    });
    render(
      changeSet({
        files: [resolved],
        totals: { files: 1, additions: 0, deletions: 0 },
      }),
      { host: 'vscode', reconciled: new Set(['src/merged.ts']) },
    );

    const row = el('[data-testid="change-set-row-reconciled"]');
    expect(text(row)).toContain('No longer changes HEAD');
    expect(query('[data-testid="change-set-row-conflicted"]')).toBeNull();
    expect(query('[data-testid="change-set-row"]')).toBeNull();
  });

  it('shows a recorded U file as conflicted only through the conflicted input', () => {
    const recorded = file({ path: 'src/merged.ts', status: 'U' });
    const set = changeSet({
      files: [recorded],
      totals: { files: 1, additions: 1, deletions: 1 },
    });
    render(set, { host: 'vscode', conflicted: new Set(['src/merged.ts']) });
    expect(query('[data-testid="change-set-row-conflicted"]')).not.toBeNull();

    // A resolved but uncommitted file: the marks drop it from conflicted.
    fixture.componentRef.setInput('conflicted', new Set<string>());
    fixture.detectChanges();
    const row = el('[data-testid="change-set-row"]');
    expect(query('[data-testid="change-set-row-conflicted"]')).toBeNull();
    expect(row.getAttribute('title')).toContain('diff');
  });

  it('shows "binary" for a binary file, never zeros', () => {
    render(
      changeSet({
        files: [
          file({
            path: 'logo.png',
            status: 'A',
            additions: null,
            deletions: null,
            binary: true,
          }),
        ],
        totals: { files: 1, additions: 0, deletions: 0 },
      }),
    );
    const counts = el('[data-testid="change-set-row-counts"]');
    expect(text(counts)).toBe('binary');
    expect(counts.className).toContain('text-base-content-muted');
  });

  it('counts files left out by the stored-file bound', () => {
    render(
      changeSet({
        truncatedCount: 7,
        totals: { files: 11, additions: 54, deletions: 42 },
      }),
    );
    expect(text(el('[data-testid="change-set-files"]'))).toBe(
      '11 files changed',
    );
    expect(text(el('[data-testid="change-set-truncated"]'))).toBe(
      '7 more files not listed',
    );
  });

  it('notes a missing baseline only when one is missing', () => {
    render(changeSet());
    expect(query('[data-testid="change-set-baseline-missing"]')).toBeNull();

    fixture.componentRef.setInput(
      'changeSet',
      changeSet({ baselineMissing: true }),
    );
    fixture.detectChanges();
    expect(text(el('[data-testid="change-set-baseline-missing"]'))).toContain(
      'before this turn started',
    );
  });

  it('uses the singular for one file', () => {
    render(
      changeSet({
        files: [file({ path: 'a.ts' })],
        totals: { files: 1, additions: 1, deletions: 1 },
      }),
    );
    expect(text(el('[data-testid="change-set-files"]'))).toBe('1 file changed');
  });

  it('draws the 9 px ghost badges in full ink (muted was 4.48:1 in light)', () => {
    render(
      changeSet({
        countsUnavailable: true,
        files: [file({ path: 'src/app.ts', additions: null, deletions: null })],
      }),
      { reconciled: new Set(['src/app.ts']) },
    );
    const badges = [
      el('[data-testid="change-set-counts-unavailable"]'),
      el('[data-testid="change-set-row-reconciled"] .badge'),
    ];
    for (const badge of badges) {
      expect(badge.classList).toContain('text-base-content');
      expect(badge.classList).not.toContain('text-base-content-muted');
    }
  });

  it('dims the reconciled path itself, outside the light theme .truncate ink rule', () => {
    render(changeSet(), { reconciled: new Set(['src/old.ts']) });
    const path = el('[data-testid="change-set-row-reconciled-path"]');
    expect(path.classList).toContain('text-base-content-muted');
    expect(path.classList).not.toContain('truncate');
    expect(path.classList).toContain('text-ellipsis');
    expect(path.getAttribute('title')).toBe('src/old.ts');
  });

  describe('narrow tile', () => {
    // jest-preset-angular strips inline `styles`, so read the source, as
    // compact-session-activity.component.spec.ts does.
    const styles = (): string => {
      const source = readFileSync(
        join(__dirname, 'change-set-card.component.ts'),
        'utf8',
      );
      return source.slice(source.indexOf('styles: ['));
    };

    it('wraps the header so Review stays on the card', () => {
      render(changeSet());
      const header = el('[data-testid="change-set-header"]');
      expect(header.classList).toContain('flex-wrap');
      expect(el('[data-testid="change-set-review"]').classList).toContain(
        'shrink-0',
      );
    });

    it('is its own inline-size container with a 240 px tier', () => {
      const css = styles();
      expect(css).toMatch(/container-type:\s*inline-size/);
      expect(css).toMatch(/@container\s*\(max-width:\s*240px\)/);
    });

    it('moves the path to a full-width line and drops the chevron in that tier', () => {
      const css = styles();
      const tier = css.slice(css.indexOf('@container'));
      expect(tier).toMatch(/\.cs-path\s*\{[^}]*flex-basis:\s*100%/);
      expect(tier).toMatch(/\.cs-row\s*\{[^}]*flex-wrap:\s*wrap/);
      expect(tier).toMatch(/\.cs-chevron\s*\{[^}]*display:\s*none/);

      render(changeSet(), { reconciled: new Set(['src/old.ts']) });
      for (const row of queryAll(
        '[data-testid="change-set-row"], [data-testid="change-set-row-reconciled"]',
      )) {
        expect(row.classList).toContain('cs-row');
        expect(row.querySelector('.cs-path')).not.toBeNull();
      }
    });
  });

  it('never uses an alpha base-content text class', () => {
    render(changeSet(), {
      host: 'vscode',
      reconciled: new Set(['src/old.ts']),
    });
    expect(fixture.nativeElement.innerHTML).not.toMatch(
      /text-base-content\/\d+/,
    );
  });
});

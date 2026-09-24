/**
 * TargetMarksComponent specs (plan C8, Task 9.1).
 *
 * `CLI_TARGET_BRANDS` decides what draws each target: `brand` entries go
 * through `ptah-brand-mark` (a monogram for VS Code, which has no artwork),
 * the `provider-mark` entry (OpenCode) through `ptah-provider-mark`. A hidden
 * list names every target.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { reflectComponentType } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CLI_TARGET_BRANDS } from '@ptah-extension/ui';

import {
  TargetMarksComponent,
  type TargetMarkItem,
} from './target-marks.component';

const CLAUDE: TargetMarkItem = { target: 'claude', label: 'Claude Code' };
const VSCODE: TargetMarkItem = { target: 'vscode', label: 'VS Code' };
const OPENCODE: TargetMarkItem = { target: 'opencode', label: 'OpenCode' };
const CURSOR: TargetMarkItem = { target: 'cursor', label: 'Cursor' };
const CODEX: TargetMarkItem = { target: 'codex', label: 'Codex CLI' };
const COPILOT: TargetMarkItem = { target: 'copilot', label: 'GitHub Copilot' };

describe('TargetMarksComponent', () => {
  let fixture: ComponentFixture<TargetMarksComponent>;
  let element: HTMLElement;

  function render(
    targets: readonly TargetMarkItem[],
    maxVisible?: number,
  ): void {
    fixture = TestBed.createComponent(TargetMarksComponent);
    fixture.componentRef.setInput('targets', targets);
    if (maxVisible !== undefined) {
      fixture.componentRef.setInput('maxVisible', maxVisible);
    }
    fixture.detectChanges();
    element = fixture.nativeElement as HTMLElement;
  }

  const markFor = (target: string): HTMLElement | null =>
    element.querySelector(`[data-target="${target}"]`);
  const srLabels = (): string[] =>
    Array.from(
      element.querySelectorAll('[data-testid="target-labels"] li'),
    ).map((li) => li.textContent?.trim() ?? '');

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [TargetMarksComponent] });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('draws a brand entry through ptah-brand-mark with vendored artwork', () => {
    expect(CLI_TARGET_BRANDS.claude.kind).toBe('brand');
    render([CLAUDE]);
    const mark = markFor('claude');
    expect(mark?.querySelector('ptah-brand-mark')).not.toBeNull();
    expect(
      mark?.querySelector('[data-testid="brand-mark-tile"]'),
    ).not.toBeNull();
    expect(mark?.querySelector('ptah-provider-mark')).toBeNull();
  });

  it('draws VS Code as a monogram', () => {
    render([VSCODE]);
    const mark = markFor('vscode');
    expect(
      mark?.querySelector('ptah-brand-mark ptah-monogram-tile'),
    ).not.toBeNull();
    expect(mark?.querySelector('[data-testid="brand-mark-tile"]')).toBeNull();
  });

  it('draws the provider-mark entry through ptah-provider-mark', () => {
    expect(CLI_TARGET_BRANDS.opencode).toEqual({
      kind: 'provider-mark',
      providerId: 'opencode',
    });
    render([OPENCODE]);
    const mark = markFor('opencode');
    expect(mark?.querySelector('ptah-provider-mark')).not.toBeNull();
    expect(mark?.querySelector('ptah-brand-mark')).toBeNull();
  });

  it('keeps the marks decorative and names every target in a hidden list', () => {
    render([CLAUDE, VSCODE, OPENCODE]);
    const marks = element.querySelector('[data-testid="target-marks"]');
    expect(marks?.getAttribute('aria-hidden')).toBe('true');
    const list = element.querySelector('[data-testid="target-labels"]');
    expect(list?.classList).toContain('sr-only');
    expect(list?.getAttribute('aria-label')).toBe('CLI targets');
    expect(srLabels()).toEqual(['Claude Code', 'VS Code', 'OpenCode']);
  });

  it('overlaps the marks in input order', () => {
    render([OPENCODE, CLAUDE]);
    const marks = element.querySelector('[data-testid="target-marks"]');
    expect(marks?.className).toContain('-space-x-1.5');
    const order = Array.from(element.querySelectorAll('[data-target]')).map(
      (node) => node.getAttribute('data-target'),
    );
    expect(order).toEqual(['opencode', 'claude']);
  });

  it('collapses marks past maxVisible into +N but lists them all', () => {
    render([CLAUDE, VSCODE, OPENCODE, CURSOR, CODEX, COPILOT], 3);
    expect(element.querySelectorAll('[data-target]')).toHaveLength(3);
    expect(
      element
        .querySelector('[data-testid="target-marks-overflow"]')
        ?.textContent?.trim(),
    ).toBe('+3');
    expect(srLabels()).toHaveLength(6);
  });

  it('shows no overflow chip when everything fits', () => {
    render([CLAUDE, VSCODE]);
    expect(
      element.querySelector('[data-testid="target-marks-overflow"]'),
    ).toBeNull();
  });

  it('draws every mark when maxVisible is Infinity', () => {
    render([CLAUDE, VSCODE, OPENCODE, CURSOR, CODEX, COPILOT], Infinity);
    expect(element.querySelectorAll('[data-target]')).toHaveLength(6);
    expect(
      element.querySelector('[data-testid="target-marks-overflow"]'),
    ).toBeNull();
  });

  it('says "No CLI targets" to assistive tech when there are none', () => {
    render([]);
    expect(element.querySelector('[data-testid="target-marks"]')).toBeNull();
    expect(
      element
        .querySelector('[data-testid="target-marks-empty"]')
        ?.textContent?.trim(),
    ).toBe('No CLI targets');
  });

  it('draws a target outside CLI_TARGET_BRANDS as a monogram of its id, without throwing', () => {
    expect(Object.hasOwn(CLI_TARGET_BRANDS, 'zed')).toBe(false);
    expect(() =>
      render([CLAUDE, { target: 'zed', label: 'Zed' }]),
    ).not.toThrow();
    const mark = markFor('zed');
    const monogram = mark?.querySelector('ptah-monogram-tile');
    expect(monogram).not.toBeNull();
    expect(monogram?.textContent?.trim()).toBe('Z');
    expect(mark?.querySelector('ptah-brand-mark')).toBeNull();
    expect(mark?.querySelector('ptah-provider-mark')).toBeNull();
    expect(srLabels()).toEqual(['Claude Code', 'Zed']);
  });

  it('never resolves an inherited key such as "constructor"', () => {
    render([{ target: 'constructor', label: 'Odd' }]);
    expect(
      markFor('constructor')?.querySelector('ptah-monogram-tile'),
    ).not.toBeNull();
  });

  it.each([undefined, null, '', '  '])(
    'falls back to the raw target id when the label is %p',
    (label) => {
      render([{ target: 'future-cli', label }]);
      expect(srLabels()).toEqual(['future-cli']);
      expect(markFor('future-cli')?.getAttribute('title')).toBe('future-cli');
      expect(
        markFor('future-cli')?.querySelector('ptah-monogram-tile'),
      ).not.toBeNull();
    },
  );

  it('falls back to the raw id for a known target with no label', () => {
    render([{ target: 'claude', label: undefined }]);
    expect(srLabels()).toEqual(['claude']);
    expect(markFor('claude')?.querySelector('ptah-brand-mark')).not.toBeNull();
  });

  it('has no theme input', () => {
    const inputs = (reflectComponentType(TargetMarksComponent)?.inputs ?? [])
      .map((entry) => entry.propName)
      .sort();
    expect(inputs).toEqual(['maxVisible', 'targets']);
  });

  it('does not use innerHTML in the component source', () => {
    const source = readFileSync(
      join(__dirname, 'target-marks.component.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/innerHTML/i);
  });
});

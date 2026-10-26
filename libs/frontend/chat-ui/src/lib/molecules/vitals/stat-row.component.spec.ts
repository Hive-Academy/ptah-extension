import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { StatCellComponent } from './stat-cell.component';
import { StatRowComponent } from './stat-row.component';
import { StatValueComponent } from './stat-value.component';

// jest-preset-angular strips component styles and jsdom does no layout, so the
// declared CSS is read from source with whitespace-tolerant patterns.
const source = (file: string): string =>
  readFileSync(join(__dirname, file), 'utf8');

/** `a: b` with any whitespace; `value` is a regex fragment. */
const decl = (property: string, value: string): RegExp =>
  new RegExp(String.raw`(^|[;{\s])${property}\s*:\s*${value}\s*;`);

/** Body of the first block whose selector/at-rule matches `head`. */
function block(text: string, head: RegExp): string {
  const match = head.exec(text);
  if (!match) return '';
  const open = text.indexOf('{', match.index + match[0].length - 1);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(open + 1, i);
  }
  return '';
}

@Component({
  standalone: true,
  imports: [StatRowComponent, StatCellComponent, StatValueComponent],
  template: `
    <ptah-stat-row [layout]="layout()" [density]="density()">
      <ptah-stat-cell label="Sessions" caption="90 days">
        <ptah-stat-value text="41" />
      </ptah-stat-cell>
      <ptah-stat-cell label="Tokens" caption="90 days">
        <ptah-stat-value text="1.2M" />
      </ptah-stat-cell>
    </ptah-stat-row>
  `,
})
class RowHostComponent {
  readonly layout = signal<'row' | 'stack'>('row');
  readonly density = signal<'regular' | 'compact'>('regular');
}

describe('StatRowComponent', () => {
  const rowCss = source('stat-row.component.ts');
  const cellCss = source('stat-cell.component.ts');

  async function render(
    layout: 'row' | 'stack' = 'row',
    density: 'regular' | 'compact' = 'regular',
  ): Promise<HTMLElement> {
    await TestBed.configureTestingModule({
      imports: [RowHostComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(RowHostComponent);
    fixture.componentInstance.layout.set(layout);
    fixture.componentInstance.density.set(density);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('reflects layout and density on the host', async () => {
    const host = await render('row', 'compact');
    const row = host.querySelector('ptah-stat-row') as HTMLElement;

    expect(row.getAttribute('data-layout')).toBe('row');
    expect(row.getAttribute('data-density')).toBe('compact');
  });

  it('declares the vg() row grid: 192 px columns, 24 px gap, centred', () => {
    const host = block(rowCss, /:host\s*\{/);
    expect(host).toMatch(decl('display', 'grid'));
    expect(host).toMatch(decl('grid-auto-flow', 'column'));
    expect(host).toMatch(decl('grid-auto-columns', '192px'));
    expect(host).toMatch(decl('column-gap', '24px'));
    expect(host).toMatch(decl('justify-content', 'center'));
    expect(host).toMatch(decl('text-align', 'left'));
  });

  it('narrows to 150 px columns and a 16 px gap under 1000 px', () => {
    const narrow = block(
      rowCss,
      /@media\s*\(\s*max-width\s*:\s*1000px\s*\)\s*\{/,
    );
    expect(narrow).toMatch(decl('grid-auto-columns', '150px'));
    expect(narrow).toMatch(decl('column-gap', '16px'));
  });

  it('sets --ptah-stat-num-size to 34 px regular and 28 px compact', () => {
    expect(block(rowCss, /:host\s*\{/)).toMatch(
      decl('--ptah-stat-num-size', '34px'),
    );
    expect(
      block(rowCss, /:host\(\s*\[data-density='compact'\]\s*\)\s*\{/),
    ).toMatch(decl('--ptah-stat-num-size', '28px'));
  });

  it('sets --ptah-stat-value-h to 56 px regular and 52 px compact', () => {
    expect(block(rowCss, /:host\s*\{/)).toMatch(
      decl('--ptah-stat-value-h', '56px'),
    );
    expect(
      block(rowCss, /:host\(\s*\[data-density='compact'\]\s*\)\s*\{/),
    ).toMatch(decl('--ptah-stat-value-h', '52px'));
  });

  it('declares the stack layout as a full-height space-between column', () => {
    const stack = block(rowCss, /:host\(\s*\[data-layout='stack'\]\s*\)\s*\{/);
    expect(stack).toMatch(decl('display', 'flex'));
    expect(stack).toMatch(decl('flex-direction', 'column'));
    expect(stack).toMatch(decl('justify-content', 'space-between'));
    expect(stack).toMatch(decl('height', '100%'));
  });

  it('gives each cell rows of 16px, the value height and auto', () => {
    const valueH = String.raw`var\(\s*--ptah-stat-value-h\s*,\s*56px\s*\)`;
    const cellHost = block(cellCss, /:host\s*\{/);
    expect(cellHost).toMatch(
      decl('grid-template-rows', String.raw`16px\s+${valueH}\s+auto`),
    );
    expect(cellHost).toMatch(decl('row-gap', '6px'));
    expect(block(cellCss, /\.ptah-stat-cell__value\s*\{/)).toMatch(
      decl('height', valueH),
    );
  });

  it('sizes a value ring from the same variable as the value row', () => {
    const ringHost = block(source('progress-ring.component.ts'), /:host\s*\{/);
    const valueH = String.raw`var\(\s*--ptah-stat-value-h\s*,\s*56px\s*\)`;
    expect(ringHost).toMatch(decl('height', valueH));
    expect(ringHost).toMatch(decl('width', valueH));
  });

  it('renders a label row in row layout', async () => {
    const host = await render('row');
    const cell = host.querySelector('ptah-stat-cell') as HTMLElement;

    expect(cell.hasAttribute('data-stacked')).toBe(false);
    expect(cell.querySelector('.ptah-stat-cell__label')?.textContent).toContain(
      'Sessions',
    );
    expect(
      cell.querySelector('.ptah-stat-cell__caption')?.textContent?.trim(),
    ).toBe('90 days');
  });

  it('renders the label as the caption line and no label row in a stack', async () => {
    const host = await render('stack');
    const cell = host.querySelector('ptah-stat-cell') as HTMLElement;

    expect(cell.hasAttribute('data-stacked')).toBe(true);
    expect(cell.querySelector('.ptah-stat-cell__label')).toBeNull();
    const caption = cell.querySelector('.ptah-stat-cell__caption');
    expect(caption?.textContent?.trim()).toBe('Sessions');
    expect(cell.getAttribute('aria-label')).toBe('Sessions');
    // The value comes before the caption line.
    const value = cell.querySelector('.ptah-stat-cell__value') as Element;
    expect(
      value.compareDocumentPosition(caption as Element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('keeps every vitals template free of innerHTML', () => {
    const files = readdirSync(__dirname).filter((file) =>
      file.endsWith('.component.ts'),
    );
    expect(files).toEqual(
      expect.arrayContaining([
        'progress-ring.component.ts',
        'plan-ring.component.ts',
        'spend-bars.component.ts',
        'activity-grid.component.ts',
        'stat-row.component.ts',
        'stat-cell.component.ts',
        'stat-value.component.ts',
        'staged-steps.component.ts',
      ]),
    );
    for (const file of files) {
      expect(source(file)).not.toMatch(/innerHTML/i);
    }
  });
});

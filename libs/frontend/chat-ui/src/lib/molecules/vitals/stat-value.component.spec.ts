import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { SpendBarsComponent } from './spend-bars.component';
import { StatValueComponent } from './stat-value.component';

@Component({
  standalone: true,
  imports: [StatValueComponent, SpendBarsComponent],
  template: `
    <ptah-stat-value text="$12.40" size="md">
      <ptah-spend-bars [values]="[1, 2, 3]" ariaLabel="Spend, last 3 days" />
    </ptah-stat-value>
  `,
})
class ValueHostComponent {}

describe('StatValueComponent', () => {
  it('renders the numeral and projects a chart after it', async () => {
    await TestBed.configureTestingModule({
      imports: [ValueHostComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(ValueHostComponent);
    fixture.detectChanges();

    const value = fixture.nativeElement.querySelector(
      'ptah-stat-value',
    ) as HTMLElement;
    expect(value.getAttribute('data-size')).toBe('md');
    const children = Array.from(value.children).map((child) =>
      child.tagName.toLowerCase(),
    );
    expect(children).toEqual(['span', 'ptah-spend-bars']);
    expect(value.querySelector('.ptah-stat-value__num')?.textContent).toBe(
      '$12.40',
    );
    fixture.destroy();
  });

  it('defaults to the lg size', async () => {
    await TestBed.configureTestingModule({
      imports: [StatValueComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(StatValueComponent);
    fixture.componentRef.setInput('text', '41');
    fixture.detectChanges();

    expect(fixture.nativeElement.getAttribute('data-size')).toBe('lg');
    fixture.destroy();
  });

  it('declares a baseline-aligned inline flex and the numeral type scale', () => {
    const flat = readFileSync(
      join(__dirname, 'stat-value.component.ts'),
      'utf8',
    ).replace(/\s+/g, ' ');

    expect(flat).toMatch(/:host \{[^}]*display: inline-flex;/);
    expect(flat).toMatch(/:host \{[^}]*align-items: baseline;/);
    expect(flat).toMatch(/:host \{[^}]*gap: 12px;/);
    expect(flat).toMatch(/\.ptah-stat-value__num \{[^}]*font-size: 34px;/);
    expect(flat).toMatch(/\.ptah-stat-value__num \{[^}]*line-height: 1;/);
    expect(flat).toMatch(/\.ptah-stat-value__num \{[^}]*font-weight: 600;/);
    expect(flat).toMatch(
      /\.ptah-stat-value__num \{[^}]*font-variant-numeric: tabular-nums;/,
    );
    expect(flat).toMatch(
      /:host\(\[data-size='md'\]\) \.ptah-stat-value__num \{[^}]*font-size: 28px;/,
    );
  });
});

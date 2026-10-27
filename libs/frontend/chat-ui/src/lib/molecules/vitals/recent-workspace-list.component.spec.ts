import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  RecentWorkspaceListComponent,
  type RecentWorkspaceItem,
} from './recent-workspace-list.component';

const ITEMS: readonly RecentWorkspaceItem[] = [
  {
    path: 'D:\\projects\\ptah-extension',
    name: 'ptah-extension',
    parent: 'D:\\projects',
    ageLabel: '2d',
  },
  {
    path: '/home/me/<b>odd</b>',
    name: '<b>odd</b>',
    parent: '/home/me',
    ageLabel: '3w',
  },
];

describe('RecentWorkspaceListComponent', () => {
  let fixture: ComponentFixture<RecentWorkspaceListComponent>;
  let host: HTMLElement;

  function render(items: readonly RecentWorkspaceItem[]): void {
    fixture.componentRef.setInput('items', items);
    fixture.detectChanges();
  }

  function rows(): HTMLButtonElement[] {
    return Array.from(host.querySelectorAll('button.ptah-recents__row'));
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RecentWorkspaceListComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(RecentWorkspaceListComponent);
    host = fixture.nativeElement;
  });

  afterEach(() => fixture.destroy());

  it('renders a navigation landmark named by its "Recent" heading', () => {
    render(ITEMS);

    const nav = host.querySelector('nav') as HTMLElement;
    const titleId = nav.getAttribute('aria-labelledby') as string;
    expect(titleId).toMatch(/^ptah-recents-title-\d+$/);
    expect(host.querySelector(`[id="${titleId}"]`)?.textContent?.trim()).toBe(
      'Recent',
    );
  });

  it('shows icon, name over parent, and age per row, with the full path as tooltip', () => {
    render(ITEMS);

    const [first] = rows();
    expect(rows()).toHaveLength(2);
    expect(first.type).toBe('button');
    expect(first.querySelector('.ptah-recents__name')?.textContent).toBe(
      'ptah-extension',
    );
    expect(first.querySelector('.ptah-recents__parent')?.textContent).toBe(
      'D:\\projects',
    );
    expect(first.querySelector('.ptah-recents__age')?.textContent?.trim()).toBe(
      '2d',
    );
    expect(first.title).toBe('D:\\projects\\ptah-extension');
    // WCAG 2.5.3: the visible content names the button, no aria-label override.
    expect(first.hasAttribute('aria-label')).toBe(false);
    expect(first.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'ptah-extension, D:\\projects, 2d',
    );
    expect(
      first.querySelector('lucide-angular')?.getAttribute('aria-hidden'),
    ).toBe('true');
  });

  it('renders every row when two items share a path', () => {
    render([ITEMS[0], { ...ITEMS[0], ageLabel: '5d' }]);

    expect(rows()).toHaveLength(2);
    expect(
      rows().map((row) =>
        row.querySelector('.ptah-recents__age')?.textContent?.trim(),
      ),
    ).toEqual(['2d', '5d']);
  });

  it('renders names and paths as text, never as markup', () => {
    render(ITEMS);

    const odd = rows()[1];
    expect(odd.querySelector('b')).toBeNull();
    expect(odd.querySelector('.ptah-recents__name')?.textContent).toBe(
      '<b>odd</b>',
    );
  });

  it('emits the row path on activation', () => {
    const opened: string[] = [];
    fixture.componentInstance.open.subscribe((path) => opened.push(path));
    render(ITEMS);

    rows()[0].click();

    expect(opened).toEqual(['D:\\projects\\ptah-extension']);
  });

  it('renders nothing for an empty list', () => {
    render([]);

    expect(host.querySelector('nav')).toBeNull();
  });

  it('declares the 20px 1fr auto row, one-line ellipsis and a focus ring', () => {
    const source = readFileSync(
      join(__dirname, 'recent-workspace-list.component.ts'),
      'utf8',
    );
    const flat = source.replace(/\s+/g, ' ');

    expect(flat).toMatch(
      /\.ptah-recents__row \{[^}]*grid-template-columns: 20px 1fr auto;/,
    );
    expect(flat).toMatch(
      /\.ptah-recents__name, \.ptah-recents__parent \{[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/,
    );
    expect(flat).toMatch(/\.ptah-recents__text \{[^}]*min-width: 0;/);
    expect(flat).toMatch(
      /\.ptah-recents__row:focus-visible \{[^}]*outline: 2px solid oklch\(var\(--p\)\);/,
    );
    expect(source).not.toMatch(/innerHTML|sparkline-track/);
  });
});

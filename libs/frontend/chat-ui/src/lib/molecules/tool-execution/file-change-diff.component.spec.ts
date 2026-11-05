import { TestBed } from '@angular/core/testing';
import { FileChangeDiffComponent } from './file-change-diff.component';
import type { FileChangeToolInput } from '@ptah-extension/shared';

describe('FileChangeDiffComponent', () => {
  function render(changes: FileChangeToolInput['changes']): HTMLElement {
    const fixture = TestBed.createComponent(FileChangeDiffComponent);
    fixture.componentRef.setInput('toolInput', { changes });
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FileChangeDiffComponent],
    }).compileComponents();
  });

  it.each([
    ['add', 'Added'],
    ['update', 'Updated'],
    ['delete', 'Deleted'],
  ] as const)('labels %s changes', (kind, label) => {
    const host = render([{ path: '/a.ts', kind: { type: kind }, diff: '' }]);
    expect(host.textContent).toContain(label);
    expect(host.textContent).toContain('/a.ts');
  });

  it('shows moved paths and multiple changes', () => {
    const host = render([
      {
        path: '/old.ts',
        kind: { type: 'update', move_path: '/new.ts' },
        diff: '',
      },
      { path: '/other.ts', kind: { type: 'delete' }, diff: '' },
    ]);
    expect(host.querySelectorAll('section')).toHaveLength(2);
    expect(host.textContent).toContain('Moved');
    expect(host.textContent).toContain('/new.ts');
  });

  it('renders markup in patch text as text, not HTML', async () => {
    const fixture = TestBed.createComponent(FileChangeDiffComponent);
    fixture.componentRef.setInput('toolInput', {
      changes: [
        {
          path: '/a.ts',
          kind: { type: 'add' },
          diff: '<img src=x onerror=alert(1)>',
        },
      ],
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain('<img');
  });

  it('renders update hunks and add/delete text through the lazy Pierre stub', async () => {
    const fixture = TestBed.createComponent(FileChangeDiffComponent);
    fixture.componentRef.setInput('toolInput', { changes: [
      { path: '/u.ts', kind: { type: 'update' }, diff: '@@ -1 +1 @@\n-old\n+new' },
      { path: '/a.ts', kind: { type: 'add' }, diff: 'new file' },
      { path: '/d.ts', kind: { type: 'delete' }, diff: 'old file' },
    ] });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelectorAll('[data-testid="mock-pierre-diff"]')).toHaveLength(3);
    expect(host.querySelector('[data-testid="mock-pierre-diff"]')?.getAttribute('data-style')).toBe('unified');
    expect(host.textContent).toContain('--- a/u.ts');
    expect(host.textContent).toContain('new file');
    expect(host.textContent).toContain('old file');
  });

  it('falls back to escaped text when Pierre reports a mapping error', async () => {
    const fixture = TestBed.createComponent(FileChangeDiffComponent);
    fixture.componentRef.setInput('toolInput', { changes: [
      { path: '/bad.ts', kind: { type: 'update' }, diff: '@@ INVALID <img src=x>' },
    ] });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('pre')?.textContent).toContain('INVALID <img');
    expect(host.querySelector('img')).toBeNull();
  });

  it('expands only the selected large file', () => {
    const long = 'x'.repeat(100_100);
    const fixture = TestBed.createComponent(FileChangeDiffComponent);
    fixture.componentRef.setInput('toolInput', { changes: [
      { path: '/a.ts', kind: { type: 'add' }, diff: long },
      { path: '/b.ts', kind: { type: 'add' }, diff: long },
    ] });
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelectorAll('pre')[0]?.textContent).toContain('Patch truncated.');
    (host.querySelectorAll('button')[0] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(host.querySelectorAll('pre')[0]?.textContent).not.toContain('Patch truncated.');
    expect(host.querySelectorAll('pre')[1]?.textContent).toContain('Patch truncated.');
  });

});

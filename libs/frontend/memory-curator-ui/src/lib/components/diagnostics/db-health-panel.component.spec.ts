import { TestBed } from '@angular/core/testing';
import type { MemoryDbHealthDto } from '@ptah-extension/shared';

import { DbHealthPanelComponent } from './db-health-panel.component';

describe('DbHealthPanelComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DbHealthPanelComponent],
    }).compileComponents();
  });

  const baseHealth: MemoryDbHealthDto = {
    memories: 100,
    memory_chunks: 614,
    memory_chunks_vec: 614,
    memory_chunks_fts: 614,
    code_symbols: 50,
    code_symbols_vec: 50,
    coherent: true,
    mismatches: [],
  };

  it('renders placeholder when no health data is supplied', () => {
    const fixture = TestBed.createComponent(DbHealthPanelComponent);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent ?? '').toContain(
      'No DB health data yet.',
    );
  });

  it('renders DB Health table with all coherent rows', () => {
    const fixture = TestBed.createComponent(DbHealthPanelComponent);
    fixture.componentRef.setInput('health', baseHealth);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent ?? '').toContain('DB Health');
    expect(root.textContent ?? '').toContain('614 / 614');
    expect(
      root.querySelectorAll('[data-testid="health-mismatch"]'),
    ).toHaveLength(0);
    expect(root.textContent ?? '').toContain('true');
  });

  it('renders ✗ MISMATCH glyph when counts disagree', () => {
    const fixture = TestBed.createComponent(DbHealthPanelComponent);
    fixture.componentRef.setInput('health', {
      ...baseHealth,
      memory_chunks: 614,
      memory_chunks_vec: 613,
      coherent: false,
    });
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const mismatch = root.querySelectorAll('[data-testid="health-mismatch"]');
    expect(mismatch.length).toBeGreaterThan(0);
    expect(mismatch[0].textContent ?? '').toContain('✗ MISMATCH');
    expect(root.textContent ?? '').toContain('false');
  });
});

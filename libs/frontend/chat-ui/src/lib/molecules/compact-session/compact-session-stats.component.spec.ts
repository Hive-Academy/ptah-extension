import { TestBed } from '@angular/core/testing';
import { CompactSessionStatsComponent } from './compact-session-stats.component';

describe(CompactSessionStatsComponent.name, () => {
  it('renders bounded metrics without a horizontal scrollbar', () => {
    TestBed.configureTestingModule({ imports: [CompactSessionStatsComponent] });
    const fixture = TestBed.createComponent(CompactSessionStatsComponent);
    fixture.componentRef.setInput('metrics', {
      model: 'a-very-long-model-name-that-must-truncate',
      tokens: 1_250_000,
      cost: 0.0012,
      agentCount: 3,
      compactionCount: 2,
    });
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;

    expect(root.textContent).toContain('1.3M tokens');
    expect(root.textContent).toContain('$0.0012');
    expect(root.textContent).toContain('3 agents');
    expect(root.textContent).toContain('2 compacted');
    expect(root.innerHTML).not.toContain('overflow-x-auto');
    expect(root.innerHTML).toContain('overflow-hidden');
  });

  it('renders the missing-cost em dash exactly', () => {
    TestBed.configureTestingModule({ imports: [CompactSessionStatsComponent] });
    const fixture = TestBed.createComponent(CompactSessionStatsComponent);
    fixture.componentRef.setInput('metrics', {
      model: null,
      tokens: 0,
      cost: null,
      agentCount: 0,
      compactionCount: 0,
    });
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Cost \u2014',
    );
  });
});

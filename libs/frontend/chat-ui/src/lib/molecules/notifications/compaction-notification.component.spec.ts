import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { CompactionNotificationComponent } from './compaction-notification.component';

describe('CompactionNotificationComponent', () => {
  let fixture: ComponentFixture<CompactionNotificationComponent>;

  function render(inputs: {
    isCompacting?: boolean;
    completed?: boolean;
    preTokens?: number | null;
    postTokens?: number | null;
  }): HTMLElement {
    TestBed.configureTestingModule({
      imports: [CompactionNotificationComponent],
    });
    fixture = TestBed.createComponent(CompactionNotificationComponent);
    fixture.componentRef.setInput('isCompacting', inputs.isCompacting ?? false);
    fixture.componentRef.setInput('completed', inputs.completed ?? false);
    if (inputs.preTokens !== undefined) {
      fixture.componentRef.setInput('preTokens', inputs.preTokens);
    }
    if (inputs.postTokens !== undefined) {
      fixture.componentRef.setInput('postTokens', inputs.postTokens);
    }
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function text(root: HTMLElement, testId: string): string {
    return (root.querySelector(`[data-testid="${testId}"]`)?.textContent ?? '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  afterEach(() => TestBed.resetTestingModule());

  it('renders nothing when idle', () => {
    const root = render({});
    expect(
      root.querySelector('[data-testid="compaction-notification"]'),
    ).toBeNull();
  });

  it('shows an indeterminate card while compacting', () => {
    const root = render({ isCompacting: true, preTokens: 180_000 });

    expect(text(root, 'compaction-title')).toBe('Compacting context');
    expect(
      root
        .querySelector('[data-testid="compaction-progress"]')
        ?.getAttribute('role'),
    ).toBe('progressbar');
    expect(root.querySelector('[data-testid="compaction-stats"]')).toBeNull();
    expect(text(root, 'compaction-body')).toContain('Summarizing conversation');
  });

  it('shows before, after and freed when the completion event has both counts', () => {
    const root = render({
      completed: true,
      preTokens: 210_000,
      postTokens: 40_000,
    });

    expect(text(root, 'compaction-title')).toBe('Context compacted');
    expect(text(root, 'compaction-before')).toBe('210.0k');
    expect(text(root, 'compaction-after')).toBe('40.0k');
    expect(text(root, 'compaction-freed')).toBe('170.0k');
    expect(
      root.querySelector('progress')?.classList.contains('progress-success'),
    ).toBe(true);
  });

  it('completes without numbers when the event did not carry them', () => {
    const root = render({ completed: true, preTokens: null, postTokens: null });

    expect(text(root, 'compaction-title')).toBe('Context compacted');
    expect(root.querySelector('[data-testid="compaction-stats"]')).toBeNull();
    expect(text(root, 'compaction-body')).toContain('were not on this event');
  });
});

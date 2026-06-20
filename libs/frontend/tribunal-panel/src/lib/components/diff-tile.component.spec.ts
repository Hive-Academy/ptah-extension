import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MarkdownBlockComponent } from '@ptah-extension/markdown';
import { TribunalStateService } from '../services/tribunal-state.service';
import { DiffTileComponent } from './diff-tile.component';
import type { ForgeDiff, VendorLane } from '../types/tribunal-ui.types';

@Component({
  selector: 'ptah-markdown-block',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div data-testid="markdown-stub">{{ content }}</div>`,
})
class MarkdownBlockStubComponent {
  @Input() content!: string;
}

@Component({
  standalone: true,
  imports: [DiffTileComponent],
  template: '<ptah-diff-tile [lane]="lane" />',
})
class TestHostComponent {
  lane!: VendorLane;
}

function makeLane(overrides: Partial<VendorLane> = {}): VendorLane {
  return {
    laneId: 'lane-1',
    family: 'codex',
    displayName: 'Codex',
    cli: 'codex',
    ...overrides,
  };
}

describe('DiffTileComponent', () => {
  let diffForLane: jest.Mock<ForgeDiff | null, [string]>;

  function configure() {
    TestBed.configureTestingModule({
      imports: [TestHostComponent],
      providers: [{ provide: TribunalStateService, useValue: { diffForLane } }],
    });

    TestBed.overrideComponent(DiffTileComponent, {
      remove: { imports: [MarkdownBlockComponent] },
      add: { imports: [MarkdownBlockStubComponent] },
    });
  }

  beforeEach(() => {
    diffForLane = jest.fn().mockReturnValue(null);
  });

  it('renders the loading state when no diff is available', () => {
    configure();
    const fixture = TestBed.createComponent(TestHostComponent);
    fixture.componentInstance.lane = makeLane();

    expect(() => fixture.detectChanges()).not.toThrow();
    expect(fixture.debugElement.query(By.css('.loading'))).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('worktree');
  });

  it('renders summary, diff, and review sections when diff is present', () => {
    diffForLane.mockReturnValue({
      laneId: 'lane-1',
      summary: 'Implemented feature.',
      diff: '+ added line',
      reviewNotes: 'Looks good.',
    });
    configure();
    const fixture = TestBed.createComponent(TestHostComponent);
    fixture.componentInstance.lane = makeLane();
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('.loading'))).toBeNull();
    const stubs = fixture.debugElement.queryAll(
      By.css('[data-testid="markdown-stub"]'),
    );
    expect(stubs.length).toBeGreaterThanOrEqual(2);
  });

  it('wraps a raw diff in a fenced code block', () => {
    diffForLane.mockReturnValue({
      laneId: 'lane-1',
      summary: '',
      diff: '+ added line',
      reviewNotes: '',
    });
    configure();
    const fixture = TestBed.createComponent(TestHostComponent);
    fixture.componentInstance.lane = makeLane();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('```diff');
  });

  it('shows "No diff produced" when the diff string is empty', () => {
    diffForLane.mockReturnValue({
      laneId: 'lane-1',
      summary: 'Summary only.',
      diff: '',
      reviewNotes: '',
    });
    configure();
    const fixture = TestBed.createComponent(TestHostComponent);
    fixture.componentInstance.lane = makeLane();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('No diff produced');
  });
});

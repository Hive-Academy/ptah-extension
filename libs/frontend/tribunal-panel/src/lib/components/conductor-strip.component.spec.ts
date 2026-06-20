import {
  ChangeDetectionStrategy,
  Component,
  Input,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ExecutionTreeBuilderService } from '@ptah-extension/chat-streaming';
import { ExecutionNodeComponent } from '@ptah-extension/chat';
import { TribunalSurfaceService } from '../services/tribunal-surface.service';
import {
  TribunalStateService,
  type TribunalPhase,
} from '../services/tribunal-state.service';
import { ConductorStripComponent } from './conductor-strip.component';

@Component({
  selector: 'ptah-execution-node',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div data-testid="execution-node-stub"></div>`,
})
class ExecutionNodeStubComponent {
  @Input() node!: unknown;
  @Input() isStreaming = false;
}

@Component({
  standalone: true,
  imports: [ConductorStripComponent],
  template: '<ptah-conductor-strip />',
})
class TestHostComponent {}

describe('ConductorStripComponent', () => {
  let phaseSig: ReturnType<typeof signal<TribunalPhase>>;
  let streamingStateSig: ReturnType<
    typeof signal<{ events: Map<string, unknown> }>
  >;
  let mockTreeBuilder: jest.Mocked<
    Pick<ExecutionTreeBuilderService, 'buildTree'>
  >;

  function configure() {
    TestBed.configureTestingModule({
      imports: [TestHostComponent],
      providers: [
        {
          provide: TribunalSurfaceService,
          useValue: { streamingState: () => streamingStateSig() },
        },
        {
          provide: TribunalStateService,
          useValue: { phase: () => phaseSig() },
        },
        { provide: ExecutionTreeBuilderService, useValue: mockTreeBuilder },
      ],
    });

    TestBed.overrideComponent(ConductorStripComponent, {
      remove: { imports: [ExecutionNodeComponent] },
      add: { imports: [ExecutionNodeStubComponent] },
    });
  }

  beforeEach(() => {
    phaseSig = signal<TribunalPhase>('fan');
    streamingStateSig = signal({ events: new Map() });
    mockTreeBuilder = { buildTree: jest.fn().mockReturnValue([]) };
  });

  it('renders all three phase steps without crashing', () => {
    configure();
    const fixture = TestBed.createComponent(TestHostComponent);
    expect(() => fixture.detectChanges()).not.toThrow();

    const nav = fixture.debugElement.query(
      By.css('nav[aria-label="Tribunal phase"]'),
    );
    expect(nav.nativeElement.textContent).toContain('Fan-out');
    expect(nav.nativeElement.textContent).toContain('Critique');
    expect(nav.nativeElement.textContent).toContain('Verdict');
  });

  it('shows the waiting placeholder when there are no events', () => {
    configure();
    const fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'Waiting for the conductor',
    );
  });

  it('renders execution nodes when the tree has content', () => {
    configure();
    streamingStateSig.set({ events: new Map([['e1', {}]]) });
    mockTreeBuilder.buildTree.mockReturnValue([
      {
        id: 'n1',
        type: 'text',
        content: 'hi',
        children: [],
      } as unknown as ReturnType<
        ExecutionTreeBuilderService['buildTree']
      >[number],
    ]);

    const fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();
    expect(
      fixture.debugElement.query(By.css('[data-testid="execution-node-stub"]')),
    ).toBeTruthy();
  });

  it('marks the active phase with the primary background when phase is fan', () => {
    configure();
    phaseSig.set('fan');
    const fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();

    const steps = fixture.debugElement.queryAll(
      By.css('nav[aria-label="Tribunal phase"] > span'),
    );
    const fanStep = steps.find((s) =>
      s.nativeElement.textContent.includes('Fan-out'),
    );
    expect(fanStep?.nativeElement.className).toContain('bg-primary');
  });

  it('moves the active highlight to verdict when phase advances to verdict', () => {
    configure();
    phaseSig.set('verdict');
    const fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();

    const steps = fixture.debugElement.queryAll(
      By.css('nav[aria-label="Tribunal phase"] > span'),
    );
    const verdictStep = steps.find((s) =>
      s.nativeElement.textContent.includes('Verdict'),
    );
    const fanStep = steps.find((s) =>
      s.nativeElement.textContent.includes('Fan-out'),
    );
    expect(verdictStep?.nativeElement.className).toContain('bg-primary');
    expect(fanStep?.nativeElement.className).not.toContain('bg-primary');
  });
});

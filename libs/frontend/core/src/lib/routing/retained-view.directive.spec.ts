import {
  ApplicationRef,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  EnvironmentInjector,
  Injectable,
  ViewContainerRef,
  afterEveryRender,
  afterNextRender,
  afterRenderEffect,
  effect,
  inject,
  provideZonelessChangeDetection,
  signal,
  viewChild,
  type WritableSignal,
} from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { SURFACE_ACTIVE } from './surface-active';
import { RetainedViewDirective } from './retained-view.directive';

/**
 * The after-render phase currently executing. A sentinel `afterEveryRender`
 * sequence is registered before any directive sequence, so in every phase its
 * hook runs first (phases outer, sequences inner) and stamps the phase.
 */
const phase: { current: string | null } = { current: null };

/** `stage@phase` entries for the directive's fence and detach stages. */
let stages: string[] = [];

interface RenderRecord {
  active: boolean;
  inDocument: boolean;
  display: string;
}

interface ProbeLog {
  constructed: number;
  destroyed: number;
  effectSeen: boolean[];
  renderSeen: RenderRecord[];
  probe: Probe | null;
}

let log: ProbeLog;

@Injectable()
class ProbeState {}

@Component({
  selector: 'ptah-retained-probe',
  providers: [ProbeState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<span class="probe-text">{{ label() }}</span>',
})
class Probe {
  readonly active = inject(SURFACE_ACTIVE);
  readonly state = inject(ProbeState);
  readonly label = signal('one');
  readonly pulse = signal(0);
  private readonly element: HTMLElement = inject(ElementRef).nativeElement;

  constructor() {
    log.constructed++;
    log.probe = this;
    inject(DestroyRef).onDestroy(() => log.destroyed++);
    effect(() => {
      this.pulse();
      log.effectSeen.push(this.active());
    });
    // Mirrors the canvas latch (`canvas-layout.service.ts:73-82`):
    // a single-function afterRenderEffect, so it runs in `mixedReadWrite`.
    afterRenderEffect(() => {
      const active = this.active();
      log.renderSeen.push({
        active,
        inDocument: document.contains(this.element),
        display: this.element.parentElement?.style.display ?? '',
      });
    });
  }
}

@Component({
  imports: [RetainedViewDirective, Probe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div #retainedRoot class="retained-root" *ptahRetainWhile="active()">
      <ptah-retained-probe />
    </div>
  `,
})
class Host {
  readonly active = inject(SURFACE_ACTIVE);
  readonly retainedRoot = viewChild<ElementRef<HTMLElement>>('retainedRoot');
}

interface Harness {
  active: WritableSignal<boolean>;
  fixture: ComponentFixture<Host>;
  /** Phases in which `ViewContainerRef.detach` was called. */
  detachPhases: Array<string | null>;
  /** Change detection of the host view only, no after-render hooks. */
  checkOnly: () => void;
  root: () => HTMLElement | null;
  afterRender: (hooks: { read?: () => void; mixedReadWrite?: () => void }) => void;
}

function setup(initial: boolean): Harness {
  const active = signal(initial);
  TestBed.configureTestingModule({
    imports: [Host],
    providers: [
      provideZonelessChangeDetection(),
      { provide: SURFACE_ACTIVE, useValue: active },
    ],
  });
  const environment = TestBed.inject(EnvironmentInjector);
  const stamp = (name: string) => (): void => {
    phase.current = name;
  };
  afterEveryRender(
    {
      earlyRead: stamp('earlyRead'),
      write: stamp('write'),
      mixedReadWrite: stamp('mixedReadWrite'),
      read: stamp('read'),
    },
    { injector: environment },
  );
  const directiveStages = RetainedViewDirective.prototype as unknown as Record<
    'fence' | 'detach',
    (generation: number) => void
  >;
  for (const stage of ['fence', 'detach'] as const) {
    const original = directiveStages[stage];
    jest
      .spyOn(directiveStages, stage)
      .mockImplementation(function (this: unknown, generation: number) {
        stages.push(`${stage}@${phase.current}`);
        original.call(this, generation);
      });
  }
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const [anchor] = fixture.debugElement.queryAllNodes(
    By.directive(RetainedViewDirective),
  );
  const container = anchor.injector.get(ViewContainerRef);
  const prototype = Object.getPrototypeOf(container) as ViewContainerRef;
  const detachPhases: Array<string | null> = [];
  const original = prototype.detach;
  jest
    .spyOn(prototype, 'detach')
    .mockImplementation(function (this: ViewContainerRef, index?: number) {
      detachPhases.push(phase.current);
      return original.call(this, index);
    });
  return {
    active,
    fixture,
    detachPhases,
    checkOnly: () => fixture.changeDetectorRef.detectChanges(),
    root: () => fixture.nativeElement.querySelector('.retained-root'),
    afterRender: (hooks) => {
      afterNextRender(hooks, { injector: environment });
    },
  };
}

describe('RetainedViewDirective', () => {
  beforeEach(() => {
    log = {
      constructed: 0,
      destroyed: 0,
      effectSeen: [],
      renderSeen: [],
      probe: null,
    };
    phase.current = null;
    stages = [];
  });

  afterEach(() => jest.restoreAllMocks());

  it('T1: creates nothing while the condition starts false', () => {
    const { root } = setup(false);
    expect(log.constructed).toBe(0);
    expect(root()).toBeNull();
    expect(stages).toEqual([]);
  });

  it('T2: the first true creates and attaches the view', () => {
    const { root } = setup(true);
    expect(log.constructed).toBe(1);
    const element = root();
    expect(element).not.toBeNull();
    expect(document.contains(element)).toBe(true);
    expect(element?.style.display).toBe('');
  });

  it('T3: hides before render, detaches after it, and stops DOM writes', () => {
    const { active, fixture, root, afterRender, detachPhases } = setup(true);
    const element = root() as HTMLElement;
    let beforeRemoval: { display: string; inDocument: boolean } | null = null;
    afterRender({
      mixedReadWrite: () => {
        beforeRemoval = {
          display: element.style.display,
          inDocument: document.contains(element),
        };
      },
    });

    active.set(false);
    fixture.detectChanges();

    expect(beforeRemoval).toEqual({ display: 'none', inDocument: true });
    expect(document.contains(element)).toBe(false);
    expect(detachPhases).toEqual(['write']);
    expect(stages).toEqual(['fence@read', 'detach@write']);

    log.probe?.label.set('two');
    fixture.detectChanges();
    expect(element.querySelector('.probe-text')?.textContent).toBe('one');
  });

  it('T4: a return to true reinserts the same view without re-creating it', () => {
    const { active, fixture, root } = setup(true);
    const element = root() as HTMLElement;
    const probe = log.probe;
    const state = probe?.state;

    for (let trip = 0; trip < 3; trip++) {
      active.set(false);
      fixture.detectChanges();
      expect(document.contains(element)).toBe(false);
      active.set(true);
      fixture.detectChanges();
    }

    expect(log.constructed).toBe(1);
    expect(log.destroyed).toBe(0);
    expect(log.probe).toBe(probe);
    expect(log.probe?.state).toBe(state);
    expect(root()).toBe(element);
    expect(document.contains(element)).toBe(true);
    expect(element.style.display).toBe('');

    log.probe?.label.set('two');
    fixture.detectChanges();
    expect(element.querySelector('.probe-text')?.textContent).toBe('two');
  });

  it('T5: true -> false -> true while the fence is pending never detaches', () => {
    const { active, fixture, root, checkOnly, detachPhases } = setup(true);
    const element = root() as HTMLElement;

    active.set(false);
    checkOnly();
    // Change detection ran without after-render hooks: hidden, fence pending.
    expect(element.style.display).toBe('none');
    expect(document.contains(element)).toBe(true);
    expect(stages).toEqual([]);

    active.set(true);
    fixture.detectChanges();
    TestBed.inject(ApplicationRef).tick();

    expect(detachPhases).toEqual([]);
    expect(stages).toEqual([]);
    expect(document.contains(element)).toBe(true);
    expect(element.style.display).toBe('');
    expect(log.constructed).toBe(1);
  });

  it('T6 (A2): a host viewChild is undefined while detached and resolves after reinsert', () => {
    const { active, fixture, root } = setup(true);
    const element = root() as HTMLElement;
    const host = fixture.componentInstance;
    expect(host.retainedRoot()?.nativeElement).toBe(element);

    active.set(false);
    fixture.detectChanges();
    expect(host.retainedRoot()).toBeUndefined();

    active.set(true);
    fixture.detectChanges();
    expect(host.retainedRoot()?.nativeElement).toBe(element);
  });

  it('T7 (A1): inactive is observed before detach; view effects pause while detached', () => {
    const { active, fixture, root } = setup(true);
    const element = root() as HTMLElement;
    log.effectSeen = [];
    log.renderSeen = [];

    active.set(false);
    fixture.detectChanges();
    expect(document.contains(element)).toBe(false);
    expect(log.effectSeen).toEqual([false]);
    expect(log.renderSeen.map((record) => record.active)).toEqual([false]);

    // Pins A1: a component-bound effect in a detached view does not run.
    log.probe?.pulse.set(1);
    fixture.detectChanges();
    TestBed.inject(ApplicationRef).tick();
    expect(log.effectSeen).toEqual([false]);

    // It drains on reattach.
    active.set(true);
    fixture.detectChanges();
    expect(log.effectSeen).toEqual([false, true]);
    expect(log.renderSeen.map((record) => record.active)).toEqual([
      false,
      true,
    ]);
  });

  describe('T8: host destruction', () => {
    it('destroys an attached probe exactly once', () => {
      const { fixture } = setup(true);
      fixture.destroy();
      expect(log.destroyed).toBe(1);
    });

    it('destroys a detached probe exactly once', () => {
      const { active, fixture, root } = setup(true);
      const element = root() as HTMLElement;
      active.set(false);
      fixture.detectChanges();
      expect(document.contains(element)).toBe(false);

      fixture.destroy();
      expect(log.destroyed).toBe(1);
    });

    it('leaves nothing behind when destroyed with the fence pending', () => {
      const { active, fixture, checkOnly, detachPhases } = setup(true);
      active.set(false);
      checkOnly();
      expect(stages).toEqual([]);

      fixture.destroy();
      TestBed.inject(ApplicationRef).tick();

      expect(stages).toEqual([]);
      expect(detachPhases).toEqual([]);
      expect(log.destroyed).toBe(1);
    });

    it('leaves nothing behind when destroyed with the detach pending', () => {
      const { active, fixture, checkOnly, afterRender, detachPhases } =
        setup(true);
      active.set(false);
      checkOnly();
      // Registered after the fence, so it runs after it in the same read phase.
      afterRender({ read: () => fixture.destroy() });

      TestBed.inject(ApplicationRef).tick();
      TestBed.inject(ApplicationRef).tick();

      expect(stages).toEqual(['fence@read']);
      expect(detachPhases).toEqual([]);
      expect(log.destroyed).toBe(1);
    });
  });

  it('T12: the latch observes inactive while the nodes are still in the document', () => {
    const { active, fixture, root } = setup(true);
    const element = root() as HTMLElement;
    log.renderSeen = [];

    active.set(false);
    fixture.detectChanges();

    const inactive = log.renderSeen.filter((record) => !record.active);
    expect(inactive).toEqual([
      { active: false, inDocument: true, display: 'none' },
    ]);
    expect(document.contains(element)).toBe(false);
  });

  it('T13: a return to true with the detach stage pending never detaches', () => {
    const { active, fixture, root, checkOnly, afterRender, detachPhases } =
      setup(true);
    const element = root() as HTMLElement;

    active.set(false);
    checkOnly();
    // Pass N: the fence fires and registers the detach, then this flips back.
    afterRender({ read: () => active.set(true) });
    fixture.detectChanges();
    TestBed.inject(ApplicationRef).tick();

    expect(stages).toEqual(['fence@read']);
    expect(detachPhases).toEqual([]);
    expect(document.contains(element)).toBe(true);
    expect(element.style.display).toBe('');
    expect(log.constructed).toBe(1);
  });

  it('T14: detach is only ever called from a write hook', () => {
    const { active, fixture, detachPhases } = setup(true);
    for (let trip = 0; trip < 3; trip++) {
      active.set(false);
      fixture.detectChanges();
      active.set(true);
      fixture.detectChanges();
    }
    expect(detachPhases).toEqual(['write', 'write', 'write']);
    expect(stages).toEqual([
      'fence@read',
      'detach@write',
      'fence@read',
      'detach@write',
      'fence@read',
      'detach@write',
    ]);
    expect(log.constructed).toBe(1);
  });
});

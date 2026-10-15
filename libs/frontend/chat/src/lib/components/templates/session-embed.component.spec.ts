import {
  Component,
  EnvironmentInjector,
  Type,
  createComponent,
  inject,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SURFACE_ACTIVE } from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import { RailTranscriptRetentionCoordinator } from '../../services/rail-transcript-retention-coordinator.service';
import {
  RAIL_TRANSCRIPT_RETENTION,
  SESSION_CARD_ACTIONS,
  SESSION_CONTEXT,
  SESSION_FOCUSED,
  SESSION_START_GUARD,
  SESSION_VISIBLE,
} from '../../tokens/session-context.token';
import { RAIL_MIN_CONTENT_WIDTH } from './chat-view.component';
import { SessionEmbedComponent } from './session-embed.component';

@Component({ standalone: true, template: 'chat session' })
class ChatStubComponent {
  readonly tabId = inject(SESSION_CONTEXT);
}

describe('SessionEmbedComponent', () => {
  const active = signal(true);
  const owners = new Map<string, number>();
  const visibleTabIds = signal<ReadonlySet<string>>(new Set());
  const registerVisibleTab = jest.fn((id: string) => {
    owners.set(id, (owners.get(id) ?? 0) + 1);
    visibleTabIds.set(new Set(owners.keys()));
  });
  const unregisterVisibleTab = jest.fn((id: string) => {
    const count = owners.get(id) ?? 0;
    if (count <= 1) owners.delete(id);
    else owners.set(id, count - 1);
    visibleTabIds.set(new Set(owners.keys()));
  });

  beforeEach(() => {
    active.set(true);
    owners.clear();
    visibleTabIds.set(new Set());
    registerVisibleTab.mockClear();
    unregisterVisibleTab.mockClear();
    TestBed.configureTestingModule({
      imports: [SessionEmbedComponent],
      providers: [
        { provide: SURFACE_ACTIVE, useValue: active },
        {
          provide: TabManagerService,
          useValue: { visibleTabIds, registerVisibleTab, unregisterVisibleTab },
        },
        RailTranscriptRetentionCoordinator,
      ],
    });
  });

  function mount(id: string) {
    const fixture = TestBed.createComponent(SessionEmbedComponent);
    (fixture.componentInstance as { chatView: Type<unknown> }).chatView =
      ChatStubComponent;
    fixture.componentRef.setInput('tabId', id);
    fixture.detectChanges();
    TestBed.flushEffects();
    return fixture;
  }

  it('owns one scoped chat view and keeps token signals current when the tab changes', () => {
    const fixture = mount('first');
    const embed = fixture.componentInstance;
    const injector = embed.childInjector;
    const chat = fixture.nativeElement.querySelector('ng-component');
    expect(fixture.nativeElement.textContent).toContain('chat session');
    expect(injector.get(SESSION_CONTEXT)()).toBe('first');
    expect(injector.get(SESSION_VISIBLE)()).toBe(true);
    expect(injector.get(SESSION_FOCUSED)()).toBe(true);
    expect(injector.get(SURFACE_ACTIVE)()).toBe(true);
    expect(injector.get(RAIL_MIN_CONTENT_WIDTH)()).toBeNull();
    expect(injector.get(RAIL_TRANSCRIPT_RETENTION)).toBe(false);
    expect(injector.get(RailTranscriptRetentionCoordinator)).toBe(
      TestBed.inject(RailTranscriptRetentionCoordinator),
    );
    fixture.componentRef.setInput('tabId', 'second');
    fixture.componentRef.setInput('minContentWidth', 360);
    fixture.componentRef.setInput('focused', false);
    fixture.detectChanges();
    TestBed.flushEffects();
    expect(embed.childInjector).toBe(injector);
    expect(fixture.nativeElement.querySelector('ng-component')).toBe(chat);
    expect(injector.get(SESSION_CONTEXT)()).toBe('second');
    expect(injector.get(RAIL_MIN_CONTENT_WIDTH)()).toBe(360);
    expect(injector.get(SESSION_FOCUSED)()).toBe(false);
    expect(visibleTabIds()).toEqual(new Set(['second']));
    fixture.destroy();
    expect(visibleTabIds().size).toBe(0);
  });

  it('passes the optional start guard, card actions and rail policy', () => {
    const fixture = TestBed.createComponent(SessionEmbedComponent);
    (fixture.componentInstance as { chatView: Type<unknown> }).chatView =
      ChatStubComponent;
    const guard = jest.fn(() => 'Wait for capacity');
    const actions = { openLane: jest.fn(), openSession: jest.fn() };
    fixture.componentRef.setInput('tabId', 'guarded');
    fixture.componentRef.setInput('startGuard', guard);
    fixture.componentRef.setInput('cardActions', actions);
    fixture.componentRef.setInput('retainRailTranscript', true);
    fixture.detectChanges();
    expect(
      fixture.componentInstance.childInjector.get(SESSION_START_GUARD)?.(),
    ).toBe('Wait for capacity');
    expect(
      fixture.componentInstance.childInjector.get(SESSION_CARD_ACTIONS),
    ).toBe(actions);
    expect(
      fixture.componentInstance.childInjector.get(RAIL_TRANSCRIPT_RETENTION),
    ).toBe(true);
    fixture.destroy();
  });

  it('unregisters on hide, parent deactivation and destroy without losing another owner', () => {
    const first = mount('shared');
    const second = mount('shared');
    expect(owners.get('shared')).toBe(2);
    first.componentRef.setInput('visible', false);
    first.detectChanges();
    TestBed.flushEffects();
    expect(visibleTabIds().has('shared')).toBe(true);
    expect(first.componentInstance.childInjector.get(SESSION_VISIBLE)()).toBe(
      false,
    );
    second.destroy();
    expect(visibleTabIds().has('shared')).toBe(false);
    first.componentRef.setInput('visible', true);
    first.detectChanges();
    TestBed.flushEffects();
    active.set(false);
    first.detectChanges();
    TestBed.flushEffects();
    expect(visibleTabIds().has('shared')).toBe(false);
    first.destroy();
    expect(registerVisibleTab).toHaveBeenCalledTimes(3);
    expect(unregisterVisibleTab).toHaveBeenCalledTimes(3);
  });

  it('projects named header and add-on content', () => {
    const host = document.createElement('div');
    const header = document.createElement('div');
    const addon = document.createElement('div');
    header.setAttribute('sessionHeader', '');
    addon.setAttribute('sessionAddon', '');
    header.textContent = 'Workflow header';
    addon.textContent = 'Workflow action';
    const fixture = createComponent(SessionEmbedComponent, {
      environmentInjector: TestBed.inject(EnvironmentInjector),
      hostElement: host,
      projectableNodes: [[header], [addon]],
    });
    (fixture.instance as { chatView: Type<unknown> }).chatView =
      ChatStubComponent;
    fixture.setInput('tabId', 'projected');
    fixture.changeDetectorRef.detectChanges();
    expect(host.textContent).toContain('Workflow header');
    expect(host.textContent).toContain('Workflow action');
    expect(host.querySelector('aside')).toBeNull();
    fixture.destroy();
  });
});

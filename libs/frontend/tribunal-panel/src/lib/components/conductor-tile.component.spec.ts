/**
 * ConductorTileComponent - the conductor's ChatView keeps the display dock
 * (decision 77; TASK_2026_629 R9 F2).
 *
 * Mounting the real ChatView here would need its whole dependency graph (the
 * chat lib's `chat-view.dock.spec.ts` covers the rendered dock with the
 * token). This spec instead renders a probe in place of ChatView through the
 * conductor's own outlet and child injector, and gives the probe ChatView's
 * real Display dock providers, read from ChatView's component metadata. So the
 * check is: with the injector the conductor builds, ChatView's own dock
 * factory yields a dock.
 */

import { Component, inject, signal, type Provider } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  ChatViewComponent,
  HIDE_AGENT_SIDEBAR,
  SESSION_CONTEXT,
} from '@ptah-extension/chat';
import {
  SessionLivenessRegistry,
  TabManagerService,
} from '@ptah-extension/chat-state';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';
import { PTAH_UI_DISPLAY_DOCK } from '@ptah-extension/chat-ui';
import {
  EffortStateService,
  ModelStateService,
  VSCodeService,
} from '@ptah-extension/core';
import { TribunalStateService } from '../services/tribunal-state.service';
import { ConductorTileComponent } from './conductor-tile.component';

/** ChatView's Display dock store provider and the port that aliases it. */
function chatViewDockProviders(): Provider[] {
  const annotations = (
    ChatViewComponent as unknown as {
      __annotations__?: { providers?: unknown[] }[];
    }
  ).__annotations__;
  const providers = (annotations?.[0]?.providers ?? []) as {
    provide?: unknown;
    useExisting?: unknown;
  }[];
  const port = providers.find((p) => p?.provide === PTAH_UI_DISPLAY_DOCK);
  const store = providers.find(
    (p) => port !== undefined && p?.provide === port.useExisting,
  );
  return port && store ? [store as Provider, port as Provider] : [];
}

const DOCK_PROVIDERS = chatViewDockProviders();

@Component({
  selector: 'ptah-conductor-chat-probe',
  standalone: true,
  template: '',
  providers: DOCK_PROVIDERS,
})
class ChatViewDockProbeComponent {
  readonly dock = inject(PTAH_UI_DISPLAY_DOCK, { optional: true });
  readonly hideAgents = inject(HIDE_AGENT_SIDEBAR, { optional: true });
  readonly sessionContext = inject(SESSION_CONTEXT, { optional: true });
}

describe('ConductorTileComponent', () => {
  let fixture: ComponentFixture<ConductorTileComponent>;

  function mount(electron: boolean): void {
    TestBed.configureTestingModule({
      imports: [ConductorTileComponent],
      providers: [
        {
          provide: TribunalStateService,
          useValue: {
            tribunalSessionId: signal<string | null>('session-c'),
            correlationId: signal<string | null>('tab-c'),
          },
        },
        {
          provide: SessionLivenessRegistry,
          useValue: { statuses: signal(new Map<string, string>()) },
        },
        {
          provide: TabManagerService,
          useValue: {
            tabs: signal([]),
            getTabViewMode: jest.fn(() => 'full'),
            registerVisibleTab: jest.fn(),
            unregisterVisibleTab: jest.fn(),
            setOverrideEffort: jest.fn(),
            setOverrideModel: jest.fn(),
          },
        },
        {
          provide: EffortStateService,
          useValue: { isLoaded: signal(false), currentEffort: signal(null) },
        },
        {
          provide: ModelStateService,
          useValue: { isLoaded: signal(false), currentModel: signal(null) },
        },
        {
          provide: AgentMonitorStore,
          useValue: { agentsForSession: jest.fn(() => []) },
        },
        { provide: VSCodeService, useValue: { isElectron: electron } },
      ],
    });
    fixture = TestBed.createComponent(ConductorTileComponent);
    // Render the probe through the conductor's own outlet and injector.
    (
      fixture.componentInstance as unknown as { chatViewComponent: unknown }
    ).chatViewComponent = ChatViewDockProbeComponent;
    fixture.detectChanges();
  }

  function probe(): ChatViewDockProbeComponent {
    const el = fixture.debugElement.query(
      (node) => node.componentInstance instanceof ChatViewDockProbeComponent,
    );
    expect(el).toBeTruthy();
    return el.componentInstance as ChatViewDockProbeComponent;
  }

  afterEach(() => {
    fixture?.destroy();
    TestBed.resetTestingModule();
  });

  it('reads ChatView’s Display dock providers from its metadata', () => {
    expect(DOCK_PROVIDERS).toHaveLength(2);
  });

  it('keeps the display dock in the conductor ChatView in Electron (decision 77)', () => {
    mount(true);
    const chat = probe();
    // The conductor still hides the Agents list (panelists are tiles) ...
    expect(chat.hideAgents).toBe(true);
    expect(chat.sessionContext?.()).toBe('tab-c');
    // ... and the token no longer removes the dock store.
    expect(chat.dock).not.toBeNull();
    expect(chat.dock).toBeDefined();
  });

  it('has no dock in VS Code, as every other host', () => {
    mount(false);
    expect(probe().dock).toBeNull();
  });
});

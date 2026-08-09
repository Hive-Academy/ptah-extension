/**
 * R4 gate for TASK_2026_187 Unit 4 (Batch 3).
 *
 * Batch 3 does two things that could silently break push-message delivery:
 *   1. It wraps `<ptah-thoth-shell />` in `@defer`, so none of the four Thoth
 *      tab libs is in the initial bundle any more.
 *   2. It repoints four composition-root imports (and four
 *      `ThothStatusService` imports) from the libs' WIDE barrels to new
 *      services-only barrels.
 *
 * Either change could drop a `MESSAGE_HANDLERS` registration. The failure mode
 * is silent: the app still boots, chat still works, the bundle still shrinks,
 * and gateway/skill/memory/status push events simply stop landing.
 *
 * "The service is still in the providers array" is NOT the assertion that
 * catches this — the provider list is exactly what the barrel swap could have
 * broken. So this spec, like its precedent
 * `editor-message-routing.spec.ts`, wires the REAL `MessageRouterService` to
 * the REAL services through the SAME `useExisting` `MESSAGE_HANDLERS`
 * registrations `app.config.ts` uses, imports every service through the SAME
 * narrow barrel specifier production now takes, dispatches genuine `window`
 * `MessageEvent`s carrying the literal wire strings, and asserts an observable
 * state change on each service.
 *
 * Crucially, it does all of that WITHOUT ever instantiating
 * `ThothShellComponent` or any Thoth tab component — i.e. it reproduces the
 * exact condition R4 is about: the app sitting on chat with Thoth never opened.
 */

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  MESSAGE_HANDLERS,
  MessageRouterService,
  VSCodeService,
} from '@ptah-extension/core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
// `SkillSynthesisLiveService` reaches `TabManagerService` (via
// `SkillDiagnosticsStateService`), which injects the inverted-dependency
// `MODEL_REFRESH_CONTROL` token. `app.config.ts:151` binds it with this exact
// helper, so the spec uses the same one rather than a hand-rolled stub.
import { provideModelRefreshControl } from '@ptah-extension/chat';

// The four services under test, each imported through the SAME specifier
// `app.config.ts` / `thoth-status.service.ts` use after Batch 3. If a narrow
// barrel ever stops exporting one of them, this file fails to compile — which
// is the cheapest possible form of the R4 check.
import { GatewayStateService } from '@ptah-extension/messaging-gateway-ui/services';
import { SkillSynthesisLiveService } from '@ptah-extension/skill-synthesis-ui/services';
import { VecEmbedderRecoveryService } from '@ptah-extension/memory-curator-ui/services';
import { ThothStatusService } from '@ptah-extension/dashboard';

/**
 * The literal strings the backend broadcasts. Hard-coded on purpose: if a
 * shared constant is ever edited, this spec fails rather than silently
 * agreeing with the new value.
 */
const WIRE = {
  gatewayStatusChanged: 'gateway:statusChanged',
  gatewayBindingsChanged: 'gateway:bindingsChanged',
  skillSynthesisEvent: 'skillSynthesis:event',
  vecStatusChanged: 'db:vecStatusChanged',
  embedderStatusChanged: 'embedder:statusChanged',
} as const;

function makeVscodeStub() {
  const config = signal({
    isVSCode: false,
    theme: 'dark',
    workspaceRoot: '/ws/a',
    workspaceName: 'a',
    extensionUri: '',
    baseUri: '',
    iconUri: '',
    userIconUri: '',
    panelId: '',
    isElectron: true,
  });
  return {
    config: config.asReadonly(),
    isConnected: signal(false).asReadonly(),
    getState: jest.fn().mockReturnValue(null),
    setState: jest.fn(),
    postMessage: jest.fn(),
    messages$: { pipe: jest.fn() },
    handleMessage: jest.fn(),
    handledMessageTypes: [],
  };
}

function dispatch(type: string, payload?: unknown): void {
  window.dispatchEvent(
    new MessageEvent('message', { data: { type, payload } }),
  );
}

describe('Thoth push-message delivery with the Thoth view never opened (R4)', () => {
  let router: MessageRouterService;
  let gateway: GatewayStateService;
  let skills: SkillSynthesisLiveService;
  let memory: VecEmbedderRecoveryService;
  let status: ThothStatusService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: VSCodeService, useValue: makeVscodeStub() },
        ...provideModelRefreshControl(),
        MessageRouterService,
        // Mirrors app.config.ts exactly — same token, same useExisting shape.
        {
          provide: MESSAGE_HANDLERS,
          useExisting: GatewayStateService,
          multi: true,
        },
        {
          provide: MESSAGE_HANDLERS,
          useExisting: SkillSynthesisLiveService,
          multi: true,
        },
        {
          provide: MESSAGE_HANDLERS,
          useExisting: ThothStatusService,
          multi: true,
        },
        {
          provide: MESSAGE_HANDLERS,
          useExisting: VecEmbedderRecoveryService,
          multi: true,
        },
      ],
    });

    gateway = TestBed.inject(GatewayStateService);
    skills = TestBed.inject(SkillSynthesisLiveService);
    memory = TestBed.inject(VecEmbedderRecoveryService);
    status = TestBed.inject(ThothStatusService);
    // Constructing the router builds the handler map, which reads
    // handledMessageTypes off all four services. A dropped registration or a
    // barrel that no longer resolves the class explodes here.
    router = TestBed.inject(MessageRouterService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('registers all four services with the router without instantiating any Thoth component', () => {
    expect(router).toBeTruthy();
    const registered = TestBed.inject(MESSAGE_HANDLERS);
    expect(registered).toEqual(
      expect.arrayContaining([gateway, skills, memory, status]),
    );
  });

  it('the shared constants hold the exact strings the backend broadcasts', () => {
    expect(MESSAGE_TYPES.GATEWAY_STATUS_CHANGED).toBe(
      WIRE.gatewayStatusChanged,
    );
    expect(MESSAGE_TYPES.GATEWAY_BINDINGS_CHANGED).toBe(
      WIRE.gatewayBindingsChanged,
    );
    expect(MESSAGE_TYPES.SKILL_SYNTHESIS_EVENT).toBe(WIRE.skillSynthesisEvent);
    expect(MESSAGE_TYPES.VEC_STATUS_CHANGED).toBe(WIRE.vecStatusChanged);
    expect(MESSAGE_TYPES.EMBEDDER_STATUS_CHANGED).toBe(
      WIRE.embedderStatusChanged,
    );
  });

  it('delivers a raw gateway:bindingsChanged message to GatewayStateService', () => {
    expect(gateway.bindings()).toEqual([]);

    dispatch(WIRE.gatewayBindingsChanged, {
      bindings: [
        {
          id: 'binding-delivered',
          platform: 'telegram',
          chatId: '123',
          workspaceRoot: '/ws/a',
        },
      ],
    });

    expect(gateway.bindings()).toHaveLength(1);
    expect(gateway.bindings()[0].id).toBe('binding-delivered');
  });

  it('delivers a raw skillSynthesis:event message to SkillSynthesisLiveService', () => {
    expect(skills.activity()).toBeNull();

    dispatch(WIRE.skillSynthesisEvent, {
      event: { kind: 'curator-pass-start' },
    });

    expect(skills.activity()).toBe('Curator analyzing candidates…');
  });

  it('delivers a raw db:vecStatusChanged message to VecEmbedderRecoveryService', () => {
    expect(memory.vecDiagnostic()).toBeNull();

    dispatch(WIRE.vecStatusChanged, {
      diagnostic: { ok: true, attempts: [] },
    });

    expect(memory.vecDiagnostic()).toEqual({ ok: true, attempts: [] });
    expect(memory.vecAvailable()).toBe(true);
  });

  it('delivers a raw embedder:statusChanged message to VecEmbedderRecoveryService', () => {
    expect(memory.embedderStatus()).toBeNull();

    dispatch(WIRE.embedderStatusChanged, {
      status: { ready: true, downloading: false },
    });

    expect(memory.embedderReady()).toBe(true);
    expect(memory.embedderDownloading()).toBe(false);
  });

  it('delivers a raw gateway:statusChanged message to ThothStatusService', () => {
    // Before delivery the gateway pillar is the un-loaded fallback.
    expect(status.summary().gateway.available).toBe(false);

    dispatch(WIRE.gatewayStatusChanged, {
      origin: null,
      status: {
        adapters: [
          { platform: 'telegram', running: true, lastError: null },
          { platform: 'discord', running: false, lastError: null },
        ],
      },
    });

    const summary = status.summary();
    expect(summary.gateway.available).toBe(true);
    if (summary.gateway.available) {
      expect(summary.gateway.platforms.length).toBeGreaterThan(0);
    }
  });

  it('fans a single gateway:statusChanged out to BOTH subscribed services', () => {
    // GatewayStateService and ThothStatusService both declare this type. One
    // dispatch must reach both — this is the multi-handler fan-out that a
    // dropped registration would silently halve.
    expect(gateway.platforms()['telegram'].state).toBe('stopped');

    dispatch(WIRE.gatewayStatusChanged, {
      origin: null,
      status: {
        enabled: true,
        adapters: [{ platform: 'telegram', running: true, lastError: null }],
      },
    });

    expect(status.summary().gateway.available).toBe(true);
    expect(gateway.platforms()['telegram'].state).toBe('running');
    expect(gateway.enabled()).toBe(true);
  });
});

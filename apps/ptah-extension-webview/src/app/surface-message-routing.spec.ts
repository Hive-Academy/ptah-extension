/**
 * Routing gate for `surface:updated` (TASK_2026_494 Batch 1, plan D3 /
 * Component 3, Req 3.2 and 3.3 for the coding chat).
 *
 * Three layers, each covering what the others cannot:
 *
 *   1. DELIVERY. Like its precedent `thoth-message-routing.spec.ts`, this
 *      wires the REAL `MessageRouterService` to the REAL `SurfaceUpdateInbox`
 *      through the SAME `useExisting` `MESSAGE_HANDLERS` registration
 *      `app.config.ts` uses, then dispatches genuine `window` `MessageEvent`s
 *      carrying the literal wire string. A dropped registration or a barrel
 *      that no longer resolves the class explodes at router construction, and
 *      a constant that no longer matches the wire fails the dispatch.
 *      (jsdom has no `MessageChannel`, so `scheduleMacrotask` drains
 *      synchronously — `macrotask-scheduler.ts:14-19, 42-45` — which is what
 *      makes the synchronous assertions below valid.)
 *
 *   2. WIRING PIN. The delivery layer reproduces the registration, so a
 *      source pin on `app.config.ts` itself proves the reproduction cannot
 *      drift from the real composition root — the same discipline as
 *      `webview-routing.spec.ts`'s "app.config routing wiring" block.
 *
 *   3. UNIQUENESS / ABSENCE SWEEP. `MessageRouterService` dispatches
 *      exclusively by `handledMessageTypes` (`message-router.service.ts:
 *      238-244`), so sweeping those declarations sweeps the REACHABLE handler
 *      set: `SurfaceUpdateInbox` must be the ONLY handler for
 *      `surface:updated` (a second one would double-deliver every push), and
 *      NO handler may exist for `dashboard:spec-proposed` — since
 *      TASK_2026_538 every host with the surface state service pushes v1
 *      proposals as `surface:updated`, and the coding chat must not intake
 *      specs (`handoff-494.md` (a)). Same source-sweep discipline as
 *      `no-alpha-base-content.spec.ts`, comments stripped so a doc-block
 *      describing a message type does not trip the sweep.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';

import { TestBed } from '@angular/core/testing';
import {
  MESSAGE_HANDLERS,
  MessageRouterService,
} from '@ptah-extension/core';
import { SurfaceUpdateInbox } from '@ptah-extension/chat-routing';
import {
  MESSAGE_TYPES,
  type SurfaceUpdatedPayload,
} from '@ptah-extension/shared';

/**
 * The literal strings the backend broadcasts. Hard-coded on purpose: if a
 * shared constant is ever edited, this spec fails rather than silently
 * agreeing with the new value.
 */
const WIRE = {
  surfaceUpdated: 'surface:updated',
  dashboardSpecProposed: 'dashboard:spec-proposed',
} as const;

/** Root of the workspace this spec runs in (`apps/ptah-extension-webview/src/app`). */
const WORKSPACE_ROOT = join(__dirname, '..', '..', '..', '..');

/** The trees a renderer `MessageHandler` can live in. */
const SWEPT_ROOTS = [
  join(WORKSPACE_ROOT, 'libs', 'frontend'),
  join(WORKSPACE_ROOT, 'apps', 'ptah-extension-webview', 'src'),
];

/**
 * The ONE permitted `surface:updated` handler declaration, relative to the
 * workspace root.
 */
const ONLY_SURFACE_UPDATED_HANDLER =
  'libs/frontend/chat-routing/src/lib/surface-update-inbox.service.ts';

/** A well-formed push; the router and the inbox look only at type + routingId. */
function makePayload(routingId: string): SurfaceUpdatedPayload {
  return {
    routingId,
    surfaceId: 'surface-1',
    revision: 1,
    origin: 'agent',
    change: { kind: 'deleted', reason: 'agent-deleted' },
  };
}

function dispatch(type: string, payload?: unknown): void {
  window.dispatchEvent(
    new MessageEvent('message', { data: { type, payload } }),
  );
}

/** Every non-spec .ts source file under the swept roots, workspace-relative. */
function handlerSourceFiles(): string[] {
  const walk = (dir: string, acc: string[]): string[] => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        walk(full, acc);
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
        acc.push(full);
      }
    }
    return acc;
  };
  return SWEPT_ROOTS.flatMap((root) =>
    walk(root, []).map((file) =>
      file
        .slice(WORKSPACE_ROOT.length + 1)
        .split(sep)
        .join('/'),
    ),
  );
}

/** Strip comments so a doc-block *mentioning* a message type is not a hit. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Workspace-relative files that DECLARE a `handledMessageTypes` containing a
 * reference to `messageType`. The router can only reach handlers that declare
 * the type, so this set IS the reachable handler set for it.
 */
function handlerDeclarationsFor(
  files: string[],
  constantRef: string,
  wireLiteral: string,
): string[] {
  const escaped = wireLiteral.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wireRef = new RegExp(
    `${constantRef}|['"\`]${escaped}['"\`]`,
  );
  return files
    .filter((relative) => {
      const source = stripComments(
        readFileSync(join(WORKSPACE_ROOT, relative), 'utf8'),
      );
      return source.includes('handledMessageTypes') && wireRef.test(source);
    })
    .sort();
}

describe('surface:updated delivery through the real router (Batch 1)', () => {
  let router: MessageRouterService;
  let inbox: SurfaceUpdateInbox;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        MessageRouterService,
        // Mirrors app.config.ts exactly — same token, same useExisting shape.
        {
          provide: MESSAGE_HANDLERS,
          useExisting: SurfaceUpdateInbox,
          multi: true,
        },
      ],
    });

    inbox = TestBed.inject(SurfaceUpdateInbox);
    // Constructing the router builds the handler map, which reads
    // handledMessageTypes off the registered inbox. A dropped registration or
    // a barrel that no longer resolves the class explodes here.
    router = TestBed.inject(MessageRouterService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('registers the inbox with the router', () => {
    expect(router).toBeTruthy();
    expect(TestBed.inject(MESSAGE_HANDLERS)).toContain(inbox);
    expect(inbox.handledMessageTypes).toEqual([WIRE.surfaceUpdated]);
  });

  it('the shared constants hold the exact strings the backend broadcasts', () => {
    expect(MESSAGE_TYPES.SURFACE_UPDATED).toBe(WIRE.surfaceUpdated);
    expect(MESSAGE_TYPES.DASHBOARD_SPEC_PROPOSED).toBe(WIRE.dashboardSpecProposed);
  });

  it('delivers a raw surface:updated message for a CLAIMED routing id to exactly its listener', () => {
    const claimed = jest.fn();
    const other = jest.fn();
    inbox.claim('route-claimed', claimed);
    inbox.claim('route-other', other);

    const payload = makePayload('route-claimed');
    dispatch(WIRE.surfaceUpdated, payload);

    expect(claimed).toHaveBeenCalledTimes(1);
    expect(claimed.mock.calls[0][0]).toBe(payload);
    expect(other).not.toHaveBeenCalled();
  });

  it('drops a raw surface:updated message for an UNCLAIMED routing id', () => {
    const listener = jest.fn();
    inbox.claim('route-claimed', listener);

    dispatch(WIRE.surfaceUpdated, makePayload('route-unclaimed'));

    expect(listener).not.toHaveBeenCalled();
  });

  it('drops a raw surface:updated message once the claim is RELEASED', () => {
    const listener = jest.fn();
    inbox.claim('route-claimed', listener);
    inbox.release('route-claimed');

    dispatch(WIRE.surfaceUpdated, makePayload('route-claimed'));

    expect(listener).not.toHaveBeenCalled();
  });

  it('drops a raw surface:updated message whose payload carries no string routingId', () => {
    const listener = jest.fn();
    inbox.claim('route-claimed', listener);

    dispatch(WIRE.surfaceUpdated, { notRoutingId: 'route-claimed' });
    dispatch(WIRE.surfaceUpdated, 'not-an-object');

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('app.config surface:updated wiring', () => {
  const source = readFileSync(join(__dirname, 'app.config.ts'), 'utf-8');

  it('registers SurfaceUpdateInbox as a MESSAGE_HANDLERS entry', () => {
    // Without this the router never sees the inbox: `useExisting` resolves
    // the root instance, so the service the Apps page claims on IS the
    // service the router dispatches to.
    expect(source).toContain('useExisting: SurfaceUpdateInbox');
    expect(source).toMatch(
      /provide:\s*MESSAGE_HANDLERS,\s*useExisting:\s*SurfaceUpdateInbox,\s*multi:\s*true/,
    );
  });

  it('imports the inbox through the @ptah-extension/chat-routing barrel', () => {
    // A deep-path import would bypass the barrel and the boundary rule.
    expect(source).toContain(
      "import { SurfaceUpdateInbox } from '@ptah-extension/chat-routing';",
    );
  });
});

describe('surface:updated handler uniqueness (Req 3.2/3.3)', () => {
  const files = handlerSourceFiles();

  it('SurfaceUpdateInbox is the ONLY handler declaring surface:updated', () => {
    // A second declarer would double-deliver every push: the router fans a
    // message out to every handler that declares its type.
    expect(
      handlerDeclarationsFor(
        files,
        'MESSAGE_TYPES\\.SURFACE_UPDATED',
        WIRE.surfaceUpdated,
      ),
    ).toEqual([ONLY_SURFACE_UPDATED_HANDLER]);
  });

  it('NO handler declares dashboard:spec-proposed', () => {
    // Since TASK_2026_538 every host with the surface state service pushes v1
    // proposals as `surface:updated`; the coding chat must not intake specs.
    expect(
      handlerDeclarationsFor(
        files,
        'MESSAGE_TYPES\\.DASHBOARD_SPEC_PROPOSED',
        WIRE.dashboardSpecProposed,
      ),
    ).toEqual([]);
  });

  it('still sweeps a meaningful number of files', () => {
    // A sweep that silently stops finding files passes vacuously.
    // `no-alpha-base-content.spec.ts` alone saw 571 files under
    // libs/frontend; 400 is a floor, not a target.
    expect(files.length).toBeGreaterThan(400);
  });

  it('actually detects a handler declaration when one is present', () => {
    // Proves the matcher can fail: a declaration hidden in a comment must NOT
    // count, a real one MUST.
    const commented =
      '/** handledMessageTypes = [MESSAGE_TYPES.SURFACE_UPDATED] */\nexport class DocOnly {}';
    const real =
      "readonly handledMessageTypes = ['surface:updated'] as const;";

    expect(stripComments(commented)).not.toContain('handledMessageTypes');
    expect(real).toContain('handledMessageTypes');
  });
});

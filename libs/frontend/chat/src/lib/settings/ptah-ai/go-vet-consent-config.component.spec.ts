import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ClaudeRpcService, WorkspaceScopeService } from '@ptah-extension/core';
import type { RpcResult } from '@ptah-extension/core';
import {
  createMockRpcService,
  rpcError,
  rpcSuccess,
  type MockRpcService,
} from '@ptah-extension/core/testing';
import type {
  DiagnosticsGoVetConsentGetResult,
  DiagnosticsGoVetConsentSetResult,
} from '@ptah-extension/shared';

import { GoVetConsentConfigComponent } from './go-vet-consent-config.component';

const ROOT_A = 'D:\\work\\service-a';
const ROOT_B = 'D:\\work\\service-b';
const GO = 'C:\\Program Files\\Go\\bin\\go.exe';

const GET = 'diagnostics:go-vet-consent-get';
/** The host's identity token for the root and binary a GET displayed. */
const TOKEN_A = 'aaaaaaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbbbb';
const SET = 'diagnostics:go-vet-consent-set';

function getResult(
  overrides: Partial<DiagnosticsGoVetConsentGetResult> = {},
): DiagnosticsGoVetConsentGetResult {
  return {
    supported: true,
    workspace: { root: ROOT_A },
    state: 'off',
    goBinary: GO,
    confirmToken: TOKEN_A,
    ...overrides,
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

type Route = () => Promise<RpcResult<unknown>> | RpcResult<unknown>;

/** Route mock RPC responses by method; each queue entry answers one call. */
function routeRpc(rpc: MockRpcService, routes: Record<string, Route[]>): void {
  rpc.call.mockImplementation(((method: string) => {
    const queue = routes[method];
    if (!queue || queue.length === 0) {
      throw new Error(`unexpected RPC ${method}`);
    }
    const next = queue.length > 1 ? queue.shift() : queue[0];
    return Promise.resolve(next ? next() : undefined);
  }) as unknown as MockRpcService['call']);
}

function mount(rpc: MockRpcService): {
  fixture: ComponentFixture<GoVetConsentConfigComponent>;
  component: GoVetConsentConfigComponent;
  scope: WorkspaceScopeService;
} {
  TestBed.configureTestingModule({
    imports: [GoVetConsentConfigComponent],
    providers: [{ provide: ClaudeRpcService, useValue: rpc }],
  });
  const scope = TestBed.inject(WorkspaceScopeService);
  scope.switchTo(ROOT_A);
  const fixture = TestBed.createComponent(GoVetConsentConfigComponent);
  return { fixture, component: fixture.componentInstance, scope };
}

async function settle(
  fixture: ComponentFixture<GoVetConsentConfigComponent>,
): Promise<void> {
  fixture.detectChanges();
  for (let i = 0; i < 6; i++) await Promise.resolve();
  fixture.detectChanges();
}

function q<T extends HTMLElement>(
  fixture: ComponentFixture<GoVetConsentConfigComponent>,
  id: string,
): T | null {
  return fixture.nativeElement.querySelector(`[data-testid="${id}"]`);
}

function text(
  fixture: ComponentFixture<GoVetConsentConfigComponent>,
  id: string,
): string {
  return q(fixture, id)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function toggle(
  fixture: ComponentFixture<GoVetConsentConfigComponent>,
): HTMLInputElement {
  const el = q<HTMLInputElement>(fixture, 'go-vet-consent-toggle');
  if (!el) throw new Error('toggle not found');
  return el;
}

function flip(
  fixture: ComponentFixture<GoVetConsentConfigComponent>,
  checked: boolean,
): void {
  const el = toggle(fixture);
  el.checked = checked;
  el.dispatchEvent(new Event('change'));
  fixture.detectChanges();
}

function click(
  fixture: ComponentFixture<GoVetConsentConfigComponent>,
  id: string,
): void {
  const el = q<HTMLButtonElement>(fixture, id);
  if (!el) throw new Error(`${id} not found`);
  el.click();
  fixture.detectChanges();
}

function setCalls(rpc: MockRpcService): unknown[] {
  return rpc.call.mock.calls
    .filter(([method]) => method === SET)
    .map(([, params]) => params);
}

function getCount(rpc: MockRpcService): number {
  return rpc.call.mock.calls.filter(([method]) => method === GET).length;
}

describe('GoVetConsentConfigComponent', () => {
  afterEach(() => {
    jest.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('renders the root, state and Go binary from GET', async () => {
    const rpc = createMockRpcService();
    routeRpc(rpc, { [GET]: [() => rpcSuccess(getResult({ state: 'on' }))] });
    const { fixture } = mount(rpc);
    await settle(fixture);

    expect(text(fixture, 'go-vet-consent-root')).toBe(ROOT_A);
    expect(text(fixture, 'go-vet-consent-binary')).toBe(GO);
    expect(text(fixture, 'go-vet-consent-state')).toBe('On');
    expect(toggle(fixture).checked).toBe(true);
    expect(toggle(fixture).disabled).toBe(false);
  });

  it('renders nothing when the host answers supported:false', async () => {
    const rpc = createMockRpcService();
    routeRpc(rpc, {
      [GET]: [
        () =>
          rpcSuccess(
            getResult({
              supported: false,
              workspace: null,
              goBinary: undefined,
            }),
          ),
      ],
    });
    const { fixture } = mount(rpc);
    await settle(fixture);

    expect(q(fixture, 'go-vet-consent-card')).toBeNull();
    expect(fixture.nativeElement.textContent.trim()).toBe('');
  });

  it('shows a stale consent with its reason and never as on', async () => {
    const rpc = createMockRpcService();
    routeRpc(rpc, {
      [GET]: [
        () =>
          rpcSuccess(getResult({ state: 'stale', staleReason: 'go-changed' })),
      ],
    });
    const { fixture } = mount(rpc);
    await settle(fixture);

    expect(text(fixture, 'go-vet-consent-state')).toBe('Out of date');
    expect(text(fixture, 'go-vet-consent-stale')).toContain(
      'the Go toolchain changed since consent was given',
    );
    expect(toggle(fixture).checked).toBe(false);
  });

  it('enables only after an explicit confirm that names the displayed root, and sends that root', async () => {
    const rpc = createMockRpcService();
    const setAnswer: DiagnosticsGoVetConsentSetResult = {
      success: true,
      state: 'on',
    };
    routeRpc(rpc, {
      [GET]: [() => rpcSuccess(getResult())],
      [SET]: [() => rpcSuccess(setAnswer)],
    });
    const { fixture } = mount(rpc);
    await settle(fixture);

    flip(fixture, true);
    expect(setCalls(rpc)).toHaveLength(0);
    expect(text(fixture, 'go-vet-consent-confirm-root')).toBe(ROOT_A);

    click(fixture, 'go-vet-consent-allow');
    await settle(fixture);

    expect(setCalls(rpc)).toEqual([
      {
        enabled: true,
        workspaceRoot: ROOT_A,
        confirmToken: TOKEN_A,
        source: 'settings-ui',
      },
    ]);
    expect(text(fixture, 'go-vet-consent-state')).toBe('On');
    expect(text(fixture, 'go-vet-consent-success')).toBe(
      'go vet is on for this workspace.',
    );
    expect(q(fixture, 'go-vet-consent-confirm')).toBeNull();
  });

  it('cancelling the confirmation sends nothing and leaves the toggle off', async () => {
    const rpc = createMockRpcService();
    routeRpc(rpc, { [GET]: [() => rpcSuccess(getResult())] });
    const { fixture } = mount(rpc);
    await settle(fixture);

    flip(fixture, true);
    expect(toggle(fixture).checked).toBe(true);
    click(fixture, 'go-vet-consent-cancel');

    expect(setCalls(rpc)).toHaveLength(0);
    expect(q(fixture, 'go-vet-consent-confirm')).toBeNull();
    expect(toggle(fixture).checked).toBe(false);
    expect(text(fixture, 'go-vet-consent-state')).toBe('Off');
  });

  it('badge and switch show the same pending state during the confirm step', async () => {
    const rpc = createMockRpcService();
    routeRpc(rpc, { [GET]: [() => rpcSuccess(getResult())] });
    const { fixture } = mount(rpc);
    await settle(fixture);
    expect(text(fixture, 'go-vet-consent-state')).toBe('Off');

    flip(fixture, true);

    expect(toggle(fixture).checked).toBe(true);
    expect(text(fixture, 'go-vet-consent-state')).toBe('Confirm to enable');
  });

  it('the enlarged hit area around the switch toggles it', async () => {
    const rpc = createMockRpcService();
    routeRpc(rpc, { [GET]: [() => rpcSuccess(getResult())] });
    const { fixture } = mount(rpc);
    await settle(fixture);

    click(fixture, 'go-vet-consent-toggle-target');

    expect(q(fixture, 'go-vet-consent-confirm')).not.toBeNull();
    expect(text(fixture, 'go-vet-consent-state')).toBe('Confirm to enable');
  });

  it('revoke reflects the read-back state and disables the toggle while in flight', async () => {
    const rpc = createMockRpcService();
    const pending = deferred<RpcResult<unknown>>();
    routeRpc(rpc, {
      [GET]: [() => rpcSuccess(getResult({ state: 'on' }))],
      [SET]: [() => pending.promise],
    });
    const { fixture } = mount(rpc);
    await settle(fixture);

    flip(fixture, false);
    expect(setCalls(rpc)).toEqual([
      { enabled: false, workspaceRoot: ROOT_A, source: 'settings-ui' },
    ]);
    expect(toggle(fixture).disabled).toBe(true);
    expect(toggle(fixture).checked).toBe(false);
    expect(text(fixture, 'go-vet-consent-state')).toBe('Saving…');

    pending.resolve(rpcSuccess({ success: true, state: 'off' }));
    await settle(fixture);

    expect(text(fixture, 'go-vet-consent-state')).toBe('Off');
    expect(toggle(fixture).checked).toBe(false);
    expect(toggle(fixture).disabled).toBe(false);
  });

  it('closing review 4: go-changed reverts, shows the fixed message and re-fetches the binary now on PATH', async () => {
    const rpc = createMockRpcService();
    const NEW_GO = '/opt/go-new/bin/go';
    routeRpc(rpc, {
      [GET]: [
        () => rpcSuccess(getResult()),
        () => rpcSuccess(getResult({ goBinary: NEW_GO, confirmToken: 'c.d' })),
      ],
      [SET]: [() => rpcSuccess({ success: false, error: 'go-changed' })],
    });
    const { fixture } = mount(rpc);
    await settle(fixture);

    flip(fixture, true);
    click(fixture, 'go-vet-consent-allow');
    await settle(fixture);

    expect(setCalls(rpc)).toEqual([
      expect.objectContaining({ confirmToken: TOKEN_A }),
    ]);
    expect(toggle(fixture).checked).toBe(false);
    expect(text(fixture, 'go-vet-consent-error')).toContain(
      'The Go toolchain changed after this card was shown',
    );
    expect(text(fixture, 'go-vet-consent-binary')).toBe(NEW_GO);
    expect(q(fixture, 'go-vet-consent-success')).toBeNull();
  });

  it('closing review 4: after an enable the card shows the binary the host committed', async () => {
    const rpc = createMockRpcService();
    const COMMITTED = '/usr/local/go/bin/go-committed';
    routeRpc(rpc, {
      [GET]: [() => rpcSuccess(getResult())],
      [SET]: [
        () => rpcSuccess({ success: true, state: 'on', goBinary: COMMITTED }),
      ],
    });
    const { fixture } = mount(rpc);
    await settle(fixture);

    flip(fixture, true);
    click(fixture, 'go-vet-consent-allow');
    await settle(fixture);

    expect(text(fixture, 'go-vet-consent-binary')).toBe(COMMITTED);
  });

  it('workspace-changed reverts the toggle, shows the fixed message and re-fetches', async () => {
    const rpc = createMockRpcService();
    routeRpc(rpc, {
      [GET]: [
        () => rpcSuccess(getResult()),
        () => rpcSuccess(getResult({ workspace: { root: ROOT_B } })),
      ],
      [SET]: [() => rpcSuccess({ success: false, error: 'workspace-changed' })],
    });
    const { fixture } = mount(rpc);
    await settle(fixture);
    expect(getCount(rpc)).toBe(1);

    flip(fixture, true);
    click(fixture, 'go-vet-consent-allow');
    await settle(fixture);

    expect(getCount(rpc)).toBe(2);
    expect(toggle(fixture).checked).toBe(false);
    expect(text(fixture, 'go-vet-consent-error')).toContain(
      'The active workspace changed before the change was saved',
    );
    expect(text(fixture, 'go-vet-consent-root')).toBe(ROOT_B);
    expect(q(fixture, 'go-vet-consent-success')).toBeNull();
  });

  it('persist-failed reverts with no success message', async () => {
    const rpc = createMockRpcService();
    routeRpc(rpc, {
      [GET]: [() => rpcSuccess(getResult({ state: 'on' }))],
      [SET]: [() => rpcSuccess({ success: false, error: 'persist-failed' })],
    });
    const { fixture } = mount(rpc);
    await settle(fixture);

    flip(fixture, false);
    await settle(fixture);

    expect(toggle(fixture).checked).toBe(true);
    expect(text(fixture, 'go-vet-consent-state')).toBe('On');
    expect(q(fixture, 'go-vet-consent-success')).toBeNull();
    expect(text(fixture, 'go-vet-consent-error')).toContain(
      'could not be saved and verified',
    );
  });

  it('a transport failure on SET reverts the toggle', async () => {
    const rpc = createMockRpcService();
    routeRpc(rpc, {
      [GET]: [() => rpcSuccess(getResult())],
      [SET]: [() => rpcError('RPC timeout: diagnostics:go-vet-consent-set')],
    });
    const { fixture } = mount(rpc);
    await settle(fixture);

    flip(fixture, true);
    click(fixture, 'go-vet-consent-allow');
    await settle(fixture);

    expect(toggle(fixture).checked).toBe(false);
    expect(text(fixture, 'go-vet-consent-error')).toContain(
      'Could not reach the app host',
    );
    expect(text(fixture, 'go-vet-consent-error')).not.toContain('RPC timeout');
  });

  it('a scope change while a GET is in flight discards the old answer and re-fetches', async () => {
    const rpc = createMockRpcService();
    const first = deferred<RpcResult<unknown>>();
    routeRpc(rpc, {
      [GET]: [
        () => first.promise,
        () => rpcSuccess(getResult({ workspace: { root: ROOT_B } })),
      ],
    });
    const { fixture, scope } = mount(rpc);
    fixture.detectChanges();
    expect(getCount(rpc)).toBe(1);

    scope.switchTo(ROOT_B);
    await settle(fixture);
    expect(getCount(rpc)).toBe(2);
    expect(text(fixture, 'go-vet-consent-root')).toBe(ROOT_B);

    first.resolve(rpcSuccess(getResult({ state: 'on' })));
    await settle(fixture);

    expect(text(fixture, 'go-vet-consent-root')).toBe(ROOT_B);
    expect(text(fixture, 'go-vet-consent-state')).toBe('Off');
  });

  it('a scope change closes an open confirmation so a stale root cannot be confirmed', async () => {
    const rpc = createMockRpcService();
    routeRpc(rpc, {
      [GET]: [
        () => rpcSuccess(getResult()),
        () => rpcSuccess(getResult({ workspace: { root: ROOT_B } })),
      ],
    });
    const { fixture, scope } = mount(rpc);
    await settle(fixture);

    flip(fixture, true);
    expect(q(fixture, 'go-vet-consent-confirm')).not.toBeNull();

    scope.switchTo(ROOT_B);
    await settle(fixture);

    expect(q(fixture, 'go-vet-consent-confirm')).toBeNull();
    expect(setCalls(rpc)).toHaveLength(0);
  });

  it('shows a fixed error when GET fails and keeps the toggle disabled', async () => {
    const rpc = createMockRpcService();
    routeRpc(rpc, { [GET]: [() => rpcError('boom: internal detail')] });
    const { fixture } = mount(rpc);
    await settle(fixture);

    expect(text(fixture, 'go-vet-consent-error')).toBe(
      'Could not read the go vet setting for this workspace.',
    );
    expect(toggle(fixture).disabled).toBe(true);
  });

  it('keeps the toggle disabled when no workspace is open', async () => {
    const rpc = createMockRpcService();
    routeRpc(rpc, {
      [GET]: [() => rpcSuccess(getResult({ workspace: null }))],
    });
    const { fixture } = mount(rpc);
    await settle(fixture);

    expect(text(fixture, 'go-vet-consent-root')).toBe(
      'No workspace folder is open',
    );
    expect(toggle(fixture).disabled).toBe(true);
  });

  it('renders the approved card, table-xs rows, a daisyUI toggle switch and a plain text state (V26/V27)', async () => {
    const rpc = createMockRpcService();
    routeRpc(rpc, { [GET]: [() => rpcSuccess(getResult({ state: 'on' }))] });
    const { fixture } = mount(rpc);
    await settle(fixture);

    const card = q(fixture, 'go-vet-consent-card');
    expect(card?.classList).toContain('card');
    expect(card?.classList).toContain('border-base-300');
    expect(q(fixture, 'go-vet-consent-table')?.classList).toContain('table-xs');
    expect(q(fixture, 'go-vet-consent-root')?.tagName).toBe('TD');

    const sw = toggle(fixture);
    expect(sw.getAttribute('role')).toBe('switch');
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(sw.classList).toContain('toggle');
    expect(sw.classList).toContain('toggle-sm');
    expect(sw.classList).not.toContain('checkbox');
    expect(q(fixture, 'go-vet-consent-toggle-target')?.classList).toContain('min-w-6');

    // A small text state beside the switch, not a second badge.
    const state = q(fixture, 'go-vet-consent-state');
    expect(state?.classList).not.toContain('badge');
    expect(state?.classList).toContain('text-base-content');
    expect(state?.querySelector('.bg-success')).not.toBeNull();

    // The switch row spans both columns and its label does not wrap; the
    // Workspace / Go binary rows keep their narrow label column.
    const labelCell = sw.closest('td');
    expect(labelCell?.getAttribute('colspan')).toBe('2');
    const label = fixture.nativeElement.querySelector(
      'label[for="go-vet-consent-toggle"]',
    ) as HTMLElement | null;
    expect(label?.classList).toContain('whitespace-nowrap');
    const rowHeaders = Array.from(
      q(fixture, 'go-vet-consent-table')?.querySelectorAll('th[scope="row"]') ?? [],
    ).map((th) => th.textContent?.trim());
    expect(rowHeaders).toEqual(['Workspace', 'Go binary']);
  });

  it('opens the P8 confirm with Cancel focused, and Esc cancels it with focus back on the switch (V28)', async () => {
    const rpc = createMockRpcService();
    routeRpc(rpc, { [GET]: [() => rpcSuccess(getResult())] });
    const { fixture } = mount(rpc);
    await settle(fixture);

    flip(fixture, true);
    await settle(fixture);

    const confirm = q(fixture, 'go-vet-consent-confirm');
    expect(confirm?.getAttribute('role')).toBe('group');
    expect(confirm?.classList).toContain('border-base-300');
    expect(document.activeElement).toBe(q(fixture, 'go-vet-consent-cancel'));

    confirm?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await settle(fixture);

    expect(q(fixture, 'go-vet-consent-confirm')).toBeNull();
    expect(setCalls(rpc)).toHaveLength(0);
    expect(document.activeElement).toBe(toggle(fixture));
  });

  it('stops the Esc keydown at the confirm, so an enclosing container does not also close (FM-4)', async () => {
    const rpc = createMockRpcService();
    routeRpc(rpc, { [GET]: [() => rpcSuccess(getResult())] });
    const { fixture } = mount(rpc);
    await settle(fixture);
    const outer = jest.fn();
    document.body.addEventListener('keydown', outer);
    try {
      flip(fixture, true);
      await settle(fixture);
      q(fixture, 'go-vet-consent-confirm')?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      await settle(fixture);
      expect(q(fixture, 'go-vet-consent-confirm')).toBeNull();
      expect(outer).not.toHaveBeenCalled();
    } finally {
      document.body.removeEventListener('keydown', outer);
    }
  });

  it.each([
    ['a thrown Error', () => Promise.reject(new Error('secret host detail'))],
    [
      'an unknown refusal code',
      () => rpcSuccess({ success: false, error: 'host detail' }),
    ],
  ] as [string, Route][])(
    'shows the fixed transport sentence, never host text, when SET fails with %s (F1)',
    async (_shape, failure) => {
      const rpc = createMockRpcService();
      routeRpc(rpc, {
        [GET]: [() => rpcSuccess(getResult())],
        [SET]: [failure],
      });
      const { fixture } = mount(rpc);
      await settle(fixture);

      flip(fixture, true);
      click(fixture, 'go-vet-consent-allow');
      await settle(fixture);

      expect(toggle(fixture).checked).toBe(false);
      expect(text(fixture, 'go-vet-consent-error')).toBe(
        'Could not reach the app host. The card shows what is stored now.',
      );
      expect(fixture.nativeElement.textContent).not.toContain('host detail');
    },
  );

  it('shows the fixed load sentence, never host text, when GET throws (F1)', async () => {
    const rpc = createMockRpcService();
    routeRpc(rpc, {
      [GET]: [() => Promise.reject(new Error('secret host detail'))],
    });
    const { fixture } = mount(rpc);
    await settle(fixture);

    expect(text(fixture, 'go-vet-consent-error')).toBe(
      'Could not read the go vet setting for this workspace.',
    );
    expect(fixture.nativeElement.textContent).not.toContain('host detail');
  });

  it('clears the success-message timer on destroy', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
    const rpc = createMockRpcService();
    routeRpc(rpc, {
      [GET]: [() => rpcSuccess(getResult({ state: 'on' }))],
      [SET]: [() => rpcSuccess({ success: true, state: 'off' })],
    });
    const { fixture } = mount(rpc);
    await settle(fixture);

    flip(fixture, false);
    await settle(fixture);
    expect(q(fixture, 'go-vet-consent-success')).not.toBeNull();
    expect(jest.getTimerCount()).toBeGreaterThan(0);

    fixture.destroy();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('sets the card description at 14 px like the sibling cards (visual m1)', async () => {
    const rpc = createMockRpcService();
    routeRpc(rpc, { [GET]: [() => rpcSuccess(getResult())] });
    const { fixture } = mount(rpc);
    await settle(fixture);
    const description = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('p')).find((p) =>
      p.textContent?.includes("When on, Ptah's diagnostics tools run your installed Go toolchain"),
    );
    expect(description?.classList).toContain('text-sm');
  });

  it('uses no text size below 12 px anywhere in the component source (Batch 50b)', () => {
    const source = readFileSync(join(__dirname, 'go-vet-consent-config.component.ts'), 'utf8');
    expect(source.match(/text-\[(?:\d|1[01])(?:\.\d+)?px\]/g)).toBeNull();
  });
});

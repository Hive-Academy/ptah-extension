/**
 * @jest-environment jsdom
 */
// Lives in activation/ rather than next to the shell because the Electron
// build copies every file under src/assets into the packaged app.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const assetsDir = join(__dirname, '..', 'assets');
const shellHtml = readFileSync(
  join(assetsDir, 'preparing-workspace.html'),
  'utf8',
);
const shellJs = readFileSync(join(assetsDir, 'preparing-workspace.js'), 'utf8');

type Payload = Record<string, unknown>;

const STEP_INDEX: Record<string, number> = { verify: 0, restore: 1, agents: 2 };

function payload(
  stepId: string,
  state: string,
  extra: Payload = {},
): { type: string; payload: Payload } {
  return {
    type: 'boot:progress',
    payload: {
      stepId,
      index: STEP_INDEX[stepId],
      total: 3,
      state,
      startedAt: 1_700_000_000_000,
      ...extra,
    },
  };
}

const listeners: Array<[string, EventListenerOrEventListenerObject]> = [];

function loadShell(search = ''): void {
  window.history.replaceState({}, '', `/${search}`);
  // Test fixture only: the shell itself never writes HTML strings.
  document.documentElement.innerHTML = shellHtml.replace(
    /^<!doctype html>/i,
    '',
  );
  const original = window.addEventListener.bind(window);
  const spy = jest.spyOn(window, 'addEventListener').mockImplementation(((
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) => {
    listeners.push([type, listener]);
    original(type, listener, options);
  }) as typeof window.addEventListener);
  // Runs the classic script the way a <script defer> would, in global scope.
  new Function(shellJs)();
  spy.mockRestore();
}

function send(data: unknown, origin = ''): void {
  window.dispatchEvent(new MessageEvent('message', { data, origin }));
}

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
};

function row(stepId: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(
    `.step[data-step="${stepId}"]`,
  );
  if (!el) throw new Error(`missing row ${stepId}`);
  return el;
}

const figure = (stepId: string): string | null =>
  row(stepId).querySelector('.step-figure')?.textContent ?? null;
const meter = (stepId: string): HTMLElement =>
  row(stepId).querySelector('.meter') as HTMLElement;

afterEach(() => {
  for (const [type, listener] of listeners.splice(0)) {
    window.removeEventListener(type, listener);
  }
});

describe('preparing workspace shell', () => {
  it('shows an indeterminate ring on step 1 before any message', () => {
    loadShell('?state=preparing');

    expect($('ring').dataset['mode']).toBe('indeterminate');
    expect($('ring').getAttribute('aria-label')).toBe('Preparing');
    expect($('ring-percent').hidden).toBe(true);
    expect($('ring-step').textContent).toBe('step 1 of 3');
    expect(row('verify').dataset['state']).toBe('active');
    expect(row('restore').dataset['state']).toBe('pending');
    expect($('detail').textContent?.trim()).toBe(
      'Verifying local state before Ptah starts.',
    );
    expect($('shell').getAttribute('aria-busy')).toBe('true');
  });

  it('renders counts, the meter and the ring percentage from valid messages', () => {
    loadShell();
    send(payload('verify', 'active'));
    send(payload('verify', 'done', { elapsedMs: 400 }));
    send(payload('restore', 'active', { done: 412, count: 660 }));

    expect(row('verify').dataset['state']).toBe('done');
    expect(figure('verify')).toBe('0.4 s');
    expect(row('restore').dataset['state']).toBe('active');
    expect(figure('restore')).toBe('412 / 660');
    expect(meter('restore').hidden).toBe(false);
    expect(
      (meter('restore').firstElementChild as HTMLElement).style.transform,
    ).toBe(`scaleX(${412 / 660})`);
    // (1 done step + 412/660) / 3 = 54.1 %
    expect($('ring').dataset['mode']).toBe('determinate');
    expect($('ring-percent').hidden).toBe(false);
    expect($('ring-percent').textContent).toBe('54%');
    expect($('ring').getAttribute('aria-label')).toBe('54%');
    expect($('ring-step').textContent).toBe('step 2 of 3');
    expect($('ring-arc').getAttribute('stroke-dasharray')).toBe(
      `${(0.54 * 439.82).toFixed(2)} 439.82`,
    );
  });

  it('updates the live region on state changes only, with counts on done', () => {
    loadShell();
    send(payload('restore', 'active', { done: 1, count: 10 }));
    expect($('detail').textContent).toBe('Restoring workspace history.');

    $('detail').textContent = 'sentinel';
    send(payload('restore', 'active', { done: 5, count: 10 }));
    expect($('detail').textContent).toBe('sentinel');
    expect(figure('restore')).toBe('5 / 10');

    send(
      payload('restore', 'done', { done: 10, count: 10, elapsedMs: 12_400 }),
    );
    expect($('detail').textContent).toBe(
      'Workspace history restored. 10 of 10.',
    );
    expect(figure('restore')).toBe('12 s');
    expect(meter('restore').hidden).toBe(true);
  });

  it.each([
    ['null data', null],
    ['another message type', { ...payload('verify', 'done'), type: 'other' }],
    ['an unknown step id', payload('index', 'done')],
    [
      'a mismatched index',
      {
        type: 'boot:progress',
        payload: { ...payload('verify', 'done').payload, index: 2 },
      },
    ],
    ['a wrong total', payload('verify', 'done', { total: 4 })],
    ['an unknown state', payload('verify', 'paused')],
    [
      'a fractional count',
      payload('restore', 'active', { done: 1.5, count: 3 }),
    ],
    ['a negative count', payload('restore', 'active', { done: -1, count: 3 })],
    ['a string count', payload('restore', 'active', { done: '1', count: 3 })],
    ['done above count', payload('restore', 'active', { done: 4, count: 3 })],
    ['an extra key', payload('verify', 'done', { label: '<b>x</b>' })],
    [
      'a missing startedAt',
      payload('verify', 'done', { startedAt: undefined }),
    ],
    ['an array payload', { type: 'boot:progress', payload: [] }],
  ])('ignores %s', (_name, data) => {
    loadShell();
    send(data);

    expect(row('verify').dataset['state']).toBe('active');
    expect(row('restore').dataset['state']).toBe('pending');
    expect($('ring').dataset['mode']).toBe('indeterminate');
  });

  it('ignores a message that carries a real postMessage origin', () => {
    loadShell();
    send(payload('verify', 'done'), 'https://example.test');

    expect(row('verify').dataset['state']).toBe('active');
  });

  it('marks a failed step, stops the ring and keeps the terminal state', () => {
    loadShell();
    send(payload('verify', 'done', { elapsedMs: 300 }));
    send(payload('restore', 'failed', { elapsedMs: 900 }));

    expect(row('restore').dataset['state']).toBe('failed');
    expect($('ring').dataset['mode']).toBe('failed');
    expect($('ring-percent').textContent).toBe('Failed');
    expect($('ring').getAttribute('aria-label')).toBe('Startup failed');
    expect($('shell').getAttribute('aria-busy')).toBe('false');
    expect($('detail').textContent).toBe(
      'Could not restore workspace history.',
    );

    send(payload('restore', 'active', { done: 1, count: 2 }));
    expect(row('restore').dataset['state']).toBe('failed');

    // A detached step settling later updates its row but not the announcement.
    send(payload('agents', 'done', { done: 6, count: 6, elapsedMs: 1200 }));
    expect(row('agents').dataset['state']).toBe('done');
    expect($('detail').textContent).toBe(
      'Could not restore workspace history.',
    );
  });

  it('reaches 100 % and announces readiness when every step is done', () => {
    loadShell();
    send(payload('verify', 'done', { elapsedMs: 300 }));
    send(payload('restore', 'done', { done: 4, count: 4, elapsedMs: 900 }));
    send(payload('agents', 'done', { done: 6, count: 6, elapsedMs: 1200 }));

    expect($('ring').dataset['mode']).toBe('done');
    expect($('ring-percent').textContent).toBe('100%');
    expect($('ring-step').textContent).toBe('step 3 of 3');
    expect($('detail').textContent).toBe('Workspace ready.');
    expect($('shell').getAttribute('aria-busy')).toBe('false');
  });

  it('keeps the recovery copy and ignores progress in the recovery state', () => {
    loadShell('?state=recovery&code=stale-copy');

    expect(document.title).toBe('Ptah — Workspace recovery required');
    expect($('title').textContent).toBe('Workspace recovery required');
    expect($('error-code').textContent).toBe('Error code: stale-copy');
    expect($('error-code').hidden).toBe(false);
    expect($('progress').hidden).toBe(true);
    expect($('steps').hidden).toBe(true);
    expect($('shell').getAttribute('aria-busy')).toBe('false');

    const detail = $('detail').textContent;
    send(payload('verify', 'done', { elapsedMs: 300 }));
    expect($('detail').textContent).toBe(detail);
    expect(row('verify').dataset['state']).toBe('active');
  });

  it('never writes HTML strings and keeps the CSP strict', () => {
    expect(shellJs).not.toMatch(
      /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/,
    );
    expect(shellHtml).toContain(
      "default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self'",
    );
    expect(shellHtml).not.toContain('<script>');
    expect(shellHtml).not.toMatch(/\sstyle=/);
  });
});

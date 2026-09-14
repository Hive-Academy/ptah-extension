/**
 * `WorkspaceWatchSupervisor` supervision, driven through a fake fork shim and a
 * manual clock: restart, resubscribe, heartbeat loss, budget exhaustion, and
 * the main-side pacing/containment of host batches. The Electron and CLI
 * facades run the shared contract suite against a REAL forked host in their
 * own `workspace-watch-host.entry.spec.ts`.
 */
import type {
  WorkspaceChangeBatch,
  WorkspaceWatchOptions,
} from '../interfaces/workspace-watcher.interface';
import type { WorkspaceChangeCoalescerClock } from '../utils/workspace-change-coalescer';
import {
  WorkspaceWatchSupervisor,
  type WorkspaceWatchHostProcess,
  type WorkspaceWatcherDegradation,
  type WorkspaceWatcherDiagnostic,
} from './workspace-watch-supervisor';

class ManualClock implements WorkspaceChangeCoalescerClock {
  private current = 5_000_000;
  private nextHandle = 1;
  private readonly timers = new Map<
    number,
    { at: number; callback: () => void }
  >();

  now(): number {
    return this.current;
  }

  setTimer(callback: () => void, delayMs: number): number {
    const handle = this.nextHandle++;
    this.timers.set(handle, { at: this.current + delayMs, callback });
    return handle;
  }

  clearTimer(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  get pendingTimers(): number {
    return this.timers.size;
  }

  /** A blocked event loop: time passes and no timer fires. */
  stall(ms: number): void {
    this.current += ms;
  }

  /**
   * One timers phase: fires what is due NOW, in due order, but not the timers
   * those callbacks schedule — they wait for the next `advance`, as a real
   * 0 ms timer waits for the next loop turn.
   */
  runDueTimers(): void {
    const due = [...this.timers.entries()]
      .filter(([, timer]) => timer.at <= this.current)
      .sort(([, a], [, b]) => a.at - b.at);
    for (const [handle, timer] of due) {
      if (!this.timers.delete(handle)) continue;
      timer.callback();
    }
  }

  advance(ms: number): void {
    const until = this.current + ms;
    for (;;) {
      let dueHandle: number | undefined;
      let dueAt = Infinity;
      for (const [handle, timer] of this.timers) {
        if (timer.at <= until && timer.at < dueAt) {
          dueAt = timer.at;
          dueHandle = handle;
        }
      }
      if (dueHandle === undefined) break;
      const timer = this.timers.get(dueHandle);
      this.timers.delete(dueHandle);
      this.current = Math.max(this.current, dueAt);
      timer?.callback();
    }
    this.current = until;
  }
}

class FakeHostProcess implements WorkspaceWatchHostProcess {
  readonly posted: unknown[] = [];
  readonly kill = jest.fn();
  private readonly messageListeners: Array<(message: unknown) => void> = [];
  private readonly exitListeners: Array<(code: number | null) => void> = [];
  throwOnPost = false;

  postMessage(message: unknown): void {
    if (this.throwOnPost) throw new Error('channel closed');
    this.posted.push(message);
  }

  on(event: 'message', listener: (message: unknown) => void): void;
  on(event: 'exit', listener: (code: number | null) => void): void;
  on(
    event: 'message' | 'exit',
    listener: ((message: unknown) => void) | ((code: number | null) => void),
  ): void {
    if (event === 'message') {
      this.messageListeners.push(listener as (message: unknown) => void);
    } else {
      this.exitListeners.push(listener as (code: number | null) => void);
    }
  }

  send(message: unknown): void {
    for (const listener of this.messageListeners) listener(message);
  }

  exit(code: number | null): void {
    for (const listener of this.exitListeners) listener(code);
  }

  heartbeat(): void {
    this.send({ type: 'heartbeat', seq: 0, subscriptions: 0, eventsPerSec: 0 });
  }

  subscribedIds(): number[] {
    return this.posted
      .filter(
        (m): m is { type: 'subscribe'; id: number } =>
          (m as { type?: string }).type === 'subscribe',
      )
      .map((m) => m.id);
  }
}

const ROOT = '/repo';

/** Advances time with the host heartbeating on its 2 s cadence. */
function advanceAlive(clock: ManualClock, host: FakeHostProcess, ms: number) {
  let remaining = ms;
  while (remaining > 0) {
    const step = Math.min(1_000, remaining);
    clock.advance(step);
    host.heartbeat();
    remaining -= step;
  }
}

function options(
  overrides: Partial<WorkspaceWatchOptions> = {},
): WorkspaceWatchOptions {
  return {
    excludeGlobs: [],
    excludeDirNames: ['node_modules'],
    excludeSegmentRules: [],
    nestedRepoDetection: false,
    ...overrides,
  };
}

function setup(forkImpl?: () => WorkspaceWatchHostProcess) {
  const clock = new ManualClock();
  const hosts: FakeHostProcess[] = [];
  const diagnostics: WorkspaceWatcherDiagnostic[] = [];
  const degradations: WorkspaceWatcherDegradation[] = [];
  const fork = jest.fn(
    forkImpl ??
      (() => {
        const host = new FakeHostProcess();
        hosts.push(host);
        return host;
      }),
  );
  const watcher = new WorkspaceWatchSupervisor({
    host: { fork },
    clock,
    onDiagnostic: (d) => diagnostics.push(d),
    onDegraded: (d) => degradations.push(d),
  });
  const record = () => {
    const batches: WorkspaceChangeBatch[] = [];
    return { batches, listener: (b: WorkspaceChangeBatch) => batches.push(b) };
  };
  const batch = (id: number, paths: string[], extra: object = {}) => ({
    type: 'batch',
    id,
    changes: paths.map((path) => ({ path, kind: 'update' })),
    truncated: false,
    overflow: false,
    droppedCount: 0,
    ...extra,
  });
  return {
    clock,
    hosts,
    fork,
    diagnostics,
    degradations,
    watcher,
    record,
    batch,
  };
}

describe('WorkspaceWatchSupervisor', () => {
  describe('host lifecycle', () => {
    it('forks nothing until the first watch, then one host for every subscription', () => {
      const { watcher, fork, hosts, record } = setup();
      expect(fork).not.toHaveBeenCalled();

      watcher.watch(ROOT, options(), record().listener);
      watcher.watch('/other', options(), record().listener);

      expect(fork).toHaveBeenCalledTimes(1);
      expect(hosts[0].posted).toEqual([
        expect.objectContaining({ type: 'subscribe', id: 1, root: ROOT }),
        expect.objectContaining({ type: 'subscribe', id: 2, root: '/other' }),
      ]);
      watcher.dispose();
    });

    it('validates options synchronously and sends nothing for a rejected subscription', () => {
      const { watcher, fork, record } = setup();
      const tooMany = Array.from({ length: 5_000 }, (_, i) => `d${i}`);
      expect(() =>
        watcher.watch(
          ROOT,
          options({ excludeDirNames: tooMany }),
          record().listener,
        ),
      ).toThrow(/protocol limits/);
      expect(fork).not.toHaveBeenCalled();
    });

    it('unsubscribes on dispose, idempotently, and stops an idle host after 30 s', () => {
      const { watcher, hosts, clock, record } = setup();
      const sub = watcher.watch(ROOT, options(), record().listener);
      sub.dispose();
      sub.dispose();
      expect(
        hosts[0].posted.filter(
          (m) => (m as { type: string }).type === 'unsubscribe',
        ),
      ).toEqual([{ type: 'unsubscribe', id: 1 }]);

      advanceAlive(clock, hosts[0], 29_999);
      expect(hosts[0].kill).not.toHaveBeenCalled();
      clock.advance(1);
      expect(hosts[0].kill).toHaveBeenCalledTimes(1);

      // A later watch forks afresh and costs no restart budget.
      watcher.watch(ROOT, options(), record().listener);
      expect(hosts).toHaveLength(2);
      watcher.dispose();
    });

    it('a watch inside the idle window keeps the running host', () => {
      const { watcher, hosts, clock, record } = setup();
      watcher.watch(ROOT, options(), record().listener).dispose();
      advanceAlive(clock, hosts[0], 10_000);
      watcher.watch(ROOT, options(), record().listener);
      advanceAlive(clock, hosts[0], 60_000 * 5);
      expect(hosts).toHaveLength(1);
      expect(hosts[0].kill).not.toHaveBeenCalled();
      watcher.dispose();
    });

    it('dispose kills the host, silences every listener and makes watch inert', () => {
      const { watcher, hosts, clock, record, batch } = setup();
      const rec = record();
      watcher.watch(ROOT, options(), rec.listener);
      hosts[0].send(batch(1, ['/repo/a.ts']));
      watcher.dispose();
      watcher.dispose();
      clock.advance(1_000);

      expect(hosts[0].kill).toHaveBeenCalledTimes(1);
      expect(rec.batches).toHaveLength(0);
      const inert = watcher.watch(ROOT, options(), rec.listener);
      inert.dispose();
      expect(hosts).toHaveLength(1);
      expect(clock.pendingTimers).toBe(0);
    });
  });

  describe('batch relay', () => {
    it('stamps the root as passed and never calls the listener synchronously', () => {
      const { watcher, hosts, clock, record, batch } = setup();
      const rec = record();
      watcher.watch('/repo/', options(), rec.listener);
      hosts[0].send(batch(1, ['/repo/a.ts']));
      expect(rec.batches).toHaveLength(0);
      clock.advance(0);
      expect(rec.batches).toEqual([
        {
          root: '/repo/',
          changes: [{ path: '/repo/a.ts', kind: 'update' }],
          truncated: false,
          overflow: false,
          droppedCount: 0,
        },
      ]);
      watcher.dispose();
    });

    it('merges host batches the transport delivered closer than 250 ms', () => {
      const { watcher, hosts, clock, record, batch } = setup();
      const rec = record();
      watcher.watch(ROOT, options(), rec.listener);
      hosts[0].send(batch(1, ['/repo/a.ts']));
      clock.advance(0);
      hosts[0].send(batch(1, ['/repo/b.ts']));
      clock.advance(10);
      hosts[0].send(batch(1, ['/repo/c.ts', '/repo/b.ts']));
      clock.advance(239);
      expect(rec.batches).toHaveLength(1);
      clock.advance(1);
      expect(rec.batches).toHaveLength(2);
      expect(rec.batches[1].changes.map((c) => c.path)).toEqual([
        '/repo/b.ts',
        '/repo/c.ts',
      ]);
      watcher.dispose();
    });

    it('drops paths from outside the root and caps merged paths, keeping truncated consistent', () => {
      const { watcher, hosts, clock, record, batch } = setup();
      const rec = record();
      watcher.watch(ROOT, options({ maxPathsPerBatch: 2 }), rec.listener);
      hosts[0].send(
        batch(1, ['/elsewhere/x.ts', '/repo-sibling/y.ts', '/repo/a.ts']),
      );
      hosts[0].send(
        batch(1, ['/repo/b.ts', '/repo/c.ts'], { droppedCount: 0 }),
      );
      clock.advance(0);
      expect(rec.batches).toEqual([
        {
          root: ROOT,
          changes: [
            { path: '/repo/a.ts', kind: 'update' },
            { path: '/repo/b.ts', kind: 'update' },
          ],
          truncated: true,
          overflow: false,
          droppedCount: 1,
        },
      ]);
      watcher.dispose();
    });

    it('keeps create when an update for the same path follows inside one window', () => {
      const { watcher, hosts, clock, record } = setup();
      const rec = record();
      watcher.watch(ROOT, options(), rec.listener);
      const host = hosts[0];
      const send = (kind: string) =>
        host.send({
          type: 'batch',
          id: 1,
          changes: [{ path: '/repo/n.ts', kind }],
          truncated: false,
          overflow: false,
          droppedCount: 0,
        });
      send('create');
      send('update');
      clock.advance(0);
      expect(rec.batches[0].changes).toEqual([
        { path: '/repo/n.ts', kind: 'create' },
      ]);
      watcher.dispose();
    });

    it('a host overflow subsumes pending and following paths until it is delivered', () => {
      const { watcher, hosts, clock, record, batch } = setup();
      const rec = record();
      watcher.watch(ROOT, options(), rec.listener);
      hosts[0].send(batch(1, ['/repo/a.ts']));
      hosts[0].send({ ...batch(1, []), overflow: true, droppedCount: 40 });
      hosts[0].send(batch(1, ['/repo/b.ts']));
      clock.advance(0);
      expect(rec.batches).toEqual([
        {
          root: ROOT,
          changes: [],
          truncated: false,
          overflow: true,
          droppedCount: 42,
        },
      ]);
      watcher.dispose();
    });

    it('reports a throwing listener and keeps delivering', () => {
      const { watcher, hosts, clock, diagnostics, batch } = setup();
      let calls = 0;
      watcher.watch(ROOT, options(), () => {
        calls++;
        throw new Error('consumer bug');
      });
      hosts[0].send(batch(1, ['/repo/a.ts']));
      clock.advance(0);
      hosts[0].send(batch(1, ['/repo/b.ts']));
      clock.advance(250);
      expect(calls).toBe(2);
      expect(
        diagnostics.filter((d) => d.message.includes('listener threw')),
      ).toHaveLength(2);
      watcher.dispose();
    });

    it('drops invalid host messages with a bounded number of diagnostics', () => {
      const { watcher, hosts, clock, record, diagnostics } = setup();
      const rec = record();
      watcher.watch(ROOT, options(), rec.listener);
      for (let i = 0; i < 25; i++) hosts[0].send({ type: 'batch', id: 1 });
      clock.advance(1_000);
      expect(rec.batches).toHaveLength(0);
      expect(
        diagnostics.filter((d) => d.message.includes('invalid host message')),
      ).toHaveLength(10);
      watcher.dispose();
    });

    it('logs host errors and notices, and ignores batches for unknown subscriptions', () => {
      const { watcher, hosts, clock, record, diagnostics, batch } = setup();
      const rec = record();
      watcher.watch(ROOT, options(), rec.listener);
      hosts[0].send({
        type: 'error',
        id: 1,
        code: 'native-error',
        message: 'overflow',
      });
      hosts[0].send({
        type: 'notice',
        code: 'storm-entered',
        root: ROOT,
        detail: 'x',
      });
      hosts[0].send(batch(99, ['/repo/a.ts']));
      clock.advance(0);
      expect(rec.batches).toHaveLength(0);
      expect(diagnostics).toEqual([
        expect.objectContaining({
          level: 'warn',
          message: '[WorkspaceWatcher] host error: native-error',
        }),
        expect.objectContaining({
          level: 'info',
          message: '[WorkspaceWatcher] storm-entered',
        }),
      ]);
      watcher.dispose();
    });
  });

  describe('supervision', () => {
    it("a host's stderr tail rides on the one failure line, clipped to its end", () => {
      const { watcher, hosts, record, diagnostics } = setup();
      watcher.watch(ROOT, options(), record().listener);
      const readStderrTail = jest.fn(
        () => `${'x'.repeat(3_000)}\nSegmentation fault\n`,
      );
      Object.assign(hosts[0], { readStderrTail });

      hosts[0].exit(null);

      expect(readStderrTail).toHaveBeenCalledTimes(1);
      const restarted = diagnostics.filter(
        (d) => d.message === '[WorkspaceWatcher] host restarted',
      );
      expect(restarted).toHaveLength(1);
      const detail = String(restarted[0].detail?.['detail']);
      expect(detail.startsWith('exit code null; host stderr: …')).toBe(true);
      expect(detail.endsWith('Segmentation fault')).toBe(true);
      expect(detail.length).toBeLessThan(1_100);
      watcher.dispose();
    });

    it('a failure without stderr keeps the plain detail', () => {
      const { watcher, hosts, record, diagnostics } = setup();
      watcher.watch(ROOT, options(), record().listener);
      Object.assign(hosts[0], { readStderrTail: () => '  \n' });
      hosts[0].exit(1);
      expect(diagnostics).toContainEqual(
        expect.objectContaining({
          message: '[WorkspaceWatcher] host restarted',
          detail: expect.objectContaining({ detail: 'exit code 1' }),
        }),
      );
      watcher.dispose();
    });

    it('host exit: overflow to every subscription, restart, and resubscribe', () => {
      const { watcher, hosts, clock, record, diagnostics, batch } = setup();
      const a = record();
      const b = record();
      watcher.watch(ROOT, options(), a.listener);
      const second = watcher.watch('/other', options(), b.listener);
      second.dispose();
      const c = record();
      watcher.watch('/third', options(), c.listener);

      hosts[0].exit(1);
      expect(hosts[0].kill).toHaveBeenCalledTimes(1);
      clock.advance(0);
      expect(a.batches).toEqual([
        expect.objectContaining({ overflow: true, changes: [] }),
      ]);
      expect(c.batches).toEqual([expect.objectContaining({ overflow: true })]);
      expect(b.batches).toHaveLength(0);
      expect(diagnostics).toContainEqual(
        expect.objectContaining({
          level: 'warn',
          message: '[WorkspaceWatcher] host restarted',
        }),
      );

      clock.advance(250);
      expect(hosts).toHaveLength(2);
      expect(hosts[1].subscribedIds()).toEqual([1, 3]);

      // Delivery resumes from the new host; the old host is not listened to.
      hosts[0].send(batch(1, ['/repo/stale.ts']));
      hosts[1].send(batch(1, ['/repo/fresh.ts']));
      clock.advance(250);
      expect(a.batches[1].changes.map((ch) => ch.path)).toEqual([
        '/repo/fresh.ts',
      ]);
      watcher.dispose();
    });

    it('three missed heartbeats kill and restart the host; heartbeats keep it', () => {
      const { watcher, hosts, clock, record } = setup();
      const rec = record();
      watcher.watch(ROOT, options(), rec.listener);

      for (let i = 0; i < 10; i++) {
        clock.advance(2_000);
        hosts[0].heartbeat();
      }
      expect(hosts[0].kill).not.toHaveBeenCalled();

      clock.advance(6_000);
      expect(hosts[0].kill).not.toHaveBeenCalled();
      clock.advance(2_000);
      expect(hosts[0].kill).toHaveBeenCalledTimes(1);
      expect(rec.batches).toEqual([
        expect.objectContaining({ overflow: true }),
      ]);
      clock.advance(250);
      expect(hosts).toHaveLength(2);
      expect(hosts[1].subscribedIds()).toEqual([1]);
      watcher.dispose();
    });

    it('a main-process stall past 6 s with a heartbeat queued behind the tick neither kills nor spends budget', () => {
      const { watcher, hosts, clock, record, diagnostics, fork } = setup();
      const rec = record();
      watcher.watch(ROOT, options(), rec.listener);
      advanceAlive(clock, hosts[0], 4_000);

      // Main blocks for 7 s. The host kept heartbeating; those messages sit in
      // the IPC queue behind the overdue watchdog tick.
      clock.stall(7_000);
      clock.runDueTimers();
      expect(hosts[0].kill).not.toHaveBeenCalled();
      hosts[0].heartbeat();
      clock.advance(0);

      expect(hosts[0].kill).not.toHaveBeenCalled();
      expect(fork).toHaveBeenCalledTimes(1);
      expect(rec.batches).toHaveLength(0);
      expect(
        diagnostics.filter((d) => d.message.includes('host restarted')),
      ).toHaveLength(0);

      // Watching carries on normally after the stall.
      advanceAlive(clock, hosts[0], 30_000);
      expect(hosts[0].kill).not.toHaveBeenCalled();

      // The whole budget is still there: five failures restart, none degrade.
      for (let failure = 1; failure <= 5; failure++) {
        hosts[hosts.length - 1].exit(1);
        clock.advance(250);
      }
      expect(watcher.isDegraded).toBe(false);
      expect(hosts).toHaveLength(6);
      watcher.dispose();
    });

    it('a host still silent after a main-process stall drains is killed and restarted', () => {
      const { watcher, hosts, clock, record, diagnostics } = setup();
      const rec = record();
      watcher.watch(ROOT, options(), rec.listener);
      advanceAlive(clock, hosts[0], 4_000);

      clock.stall(7_000);
      clock.runDueTimers();
      expect(hosts[0].kill).not.toHaveBeenCalled();
      clock.advance(0);

      expect(hosts[0].kill).toHaveBeenCalledTimes(1);
      expect(rec.batches).toEqual([
        expect.objectContaining({ overflow: true }),
      ]);
      expect(diagnostics).toContainEqual(
        expect.objectContaining({
          message: '[WorkspaceWatcher] host restarted',
          detail: expect.objectContaining({ reason: 'heartbeat-missed' }),
        }),
      );
      clock.advance(250);
      expect(hosts).toHaveLength(2);
      expect(hosts[1].subscribedIds()).toEqual([1]);
      watcher.dispose();
    });

    it('a subscription added while restarting is sent to the new host once', () => {
      const { watcher, hosts, clock, record } = setup();
      watcher.watch(ROOT, options(), record().listener);
      hosts[0].exit(null);
      watcher.watch('/late', options(), record().listener);
      expect(hosts[0].subscribedIds()).toEqual([1]);
      clock.advance(250);
      expect(hosts[1].subscribedIds()).toEqual([1, 2]);
      watcher.dispose();
    });

    it('a fatal message, a failed post and a failed fork are host failures', () => {
      let forks = 0;
      const created: FakeHostProcess[] = [];
      const { watcher, clock, record, diagnostics } = setup(() => {
        forks++;
        if (forks === 3) throw new Error('fork refused');
        const host = new FakeHostProcess();
        created.push(host);
        return host;
      });
      watcher.watch(ROOT, options(), record().listener);

      created[0].send({
        type: 'fatal',
        message: '@parcel/watcher failed to load',
      });
      clock.advance(250);
      expect(created).toHaveLength(2);

      created[1].throwOnPost = true;
      watcher.watch('/b', options(), record().listener);
      clock.advance(250); // fork 3 throws -> failure -> restart
      clock.advance(250);
      expect(forks).toBe(4);
      expect(created[2].subscribedIds()).toEqual([1, 2]);
      expect(
        diagnostics
          .filter((d) => d.message === '[WorkspaceWatcher] host restarted')
          .map((d) => d.detail?.['reason']),
      ).toEqual(['fatal', 'post-failed', 'fork-failed']);
      watcher.dispose();
    });

    it('a failure with no subscriptions goes idle without spending budget', () => {
      const { watcher, hosts, clock, record, diagnostics } = setup();
      watcher.watch(ROOT, options(), record().listener).dispose();
      hosts[0].exit(0);
      clock.advance(60_000);
      expect(hosts).toHaveLength(1);
      expect(diagnostics).toContainEqual(
        expect.objectContaining({
          message: '[WorkspaceWatcher] idle host stopped',
        }),
      );
      watcher.watch(ROOT, options(), record().listener);
      expect(hosts).toHaveLength(2);
      watcher.dispose();
    });

    it('budget: 5 restarts in 10 minutes, the 6th failure degrades with one report and 60 s rescans', () => {
      const { watcher, hosts, clock, record, degradations, diagnostics } =
        setup();
      const rec = record();
      watcher.watch(ROOT, options(), rec.listener);

      for (let failure = 1; failure <= 5; failure++) {
        hosts[hosts.length - 1].exit(1);
        clock.advance(250);
      }
      expect(hosts).toHaveLength(6);
      expect(watcher.isDegraded).toBe(false);

      hosts[5].exit(1);
      clock.advance(250);
      expect(hosts).toHaveLength(6);
      expect(watcher.isDegraded).toBe(true);
      expect(degradations).toEqual([
        { reason: 'exited', failuresInWindow: 6, rescanIntervalMs: 60_000 },
      ]);
      expect(diagnostics).toContainEqual(
        expect.objectContaining({
          level: 'error',
          message: '[WorkspaceWatcher] host degraded',
        }),
      );

      const overflowsAtDegrade = rec.batches.filter((b) => b.overflow).length;
      clock.advance(60_000);
      clock.advance(60_000);
      expect(rec.batches.filter((b) => b.overflow)).toHaveLength(
        overflowsAtDegrade + 2,
      );

      // A new subscription while degraded is told to rescan, and nothing forks.
      const late = record();
      watcher.watch('/late', options(), late.listener);
      clock.advance(0);
      expect(late.batches).toEqual([
        expect.objectContaining({ overflow: true }),
      ]);
      expect(hosts).toHaveLength(6);
      expect(degradations).toHaveLength(1);
      watcher.dispose();
      expect(clock.pendingTimers).toBe(0);
    });

    describe('degraded-mode recovery', () => {
      const RECOVERY_MS = 10 * 60_000;

      /** Spends the budget: five restarts, then the sixth failure degrades. */
      function degrade(ctx: ReturnType<typeof setup>) {
        for (let failure = 1; failure <= 5; failure++) {
          ctx.hosts[ctx.hosts.length - 1].exit(1);
          ctx.clock.advance(250);
        }
        ctx.hosts[5].exit(1);
        expect(ctx.watcher.isDegraded).toBe(true);
      }

      const overflowCount = (batches: WorkspaceChangeBatch[]) =>
        batches.filter((b) => b.overflow).length;

      const RECOVERED = '[WorkspaceWatcher] host recovered from degraded mode';
      const RECOVERY_FAILED =
        '[WorkspaceWatcher] degraded host recovery failed';
      const withMessage = (
        diagnostics: WorkspaceWatcherDiagnostic[],
        message: string,
      ) => diagnostics.filter((d) => d.message === message);

      it('after 10 minutes forks one host with a reset budget; acks for every subscription end the episode', () => {
        const ctx = setup();
        const { watcher, hosts, clock, record, degradations, diagnostics } =
          ctx;
        const rec = record();
        const other = record();
        watcher.watch(ROOT, options(), rec.listener);
        watcher.watch('/other', options(), other.listener);
        degrade(ctx);

        clock.advance(RECOVERY_MS - 1);
        expect(hosts).toHaveLength(6);
        clock.advance(1);
        expect(hosts).toHaveLength(7);
        expect(hosts[6].subscribedIds()).toEqual([1, 2]);

        // Alive and one of two subscriptions watched: not recovered yet.
        hosts[6].heartbeat();
        hosts[6].send({ type: 'subscribed', id: 1 });
        clock.advance(1_000);
        expect(watcher.isDegraded).toBe(true);
        expect(withMessage(diagnostics, RECOVERED)).toHaveLength(0);

        hosts[6].send({ type: 'subscribed', id: 2 });
        clock.advance(250);
        expect(watcher.isDegraded).toBe(false);
        expect(withMessage(diagnostics, RECOVERED)).toEqual([
          expect.objectContaining({ level: 'info' }),
        ]);

        // Back to watching: the 60 s rescans stop and batches flow again.
        const overflowsAtRecovery = overflowCount(rec.batches);
        advanceAlive(clock, hosts[6], 5 * 60_000);
        expect(overflowCount(rec.batches)).toBe(overflowsAtRecovery);
        hosts[6].send({
          type: 'batch',
          id: 1,
          changes: [{ path: '/repo/live.ts', kind: 'update' }],
          truncated: false,
          overflow: false,
          droppedCount: 0,
        });
        clock.advance(250);
        expect(rec.batches[rec.batches.length - 1].changes).toEqual([
          { path: '/repo/live.ts', kind: 'update' },
        ]);

        // The budget was reset: five failures restart without degrading.
        for (let failure = 1; failure <= 5; failure++) {
          hosts[hosts.length - 1].exit(1);
          clock.advance(250);
        }
        expect(watcher.isDegraded).toBe(false);
        expect(degradations).toHaveLength(1);
        watcher.dispose();
        expect(clock.pendingTimers).toBe(0);
      });

      it('a recovery host that only heartbeats is not recovered, and fails at the 6 s deadline', () => {
        const ctx = setup();
        const { watcher, hosts, clock, record, degradations, diagnostics } =
          ctx;
        const rec = record();
        watcher.watch(ROOT, options(), rec.listener);
        degrade(ctx);
        clock.advance(RECOVERY_MS);
        expect(hosts).toHaveLength(7);

        advanceAlive(clock, hosts[6], 5_999);
        expect(watcher.isDegraded).toBe(true);
        expect(withMessage(diagnostics, RECOVERED)).toHaveLength(0);
        expect(hosts[6].kill).not.toHaveBeenCalled();

        advanceAlive(clock, hosts[6], 1);
        expect(hosts[6].kill).toHaveBeenCalledTimes(1);
        expect(watcher.isDegraded).toBe(true);
        expect(withMessage(diagnostics, RECOVERY_FAILED)).toEqual([
          expect.objectContaining({
            level: 'warn',
            detail: expect.objectContaining({
              reason: 'recovery-unconfirmed',
            }),
          }),
        ]);
        expect(degradations).toHaveLength(1);

        // Still polling, and the next attempt is another 10 minutes out.
        const overflows = overflowCount(rec.batches);
        clock.advance(60_000);
        expect(overflowCount(rec.batches)).toBe(overflows + 1);
        clock.advance(RECOVERY_MS - 60_001);
        expect(hosts).toHaveLength(7);
        clock.advance(1);
        expect(hosts).toHaveLength(8);
        watcher.dispose();
        expect(clock.pendingTimers).toBe(0);
      });

      it.each(['native-subscribe-failed', 'subscribe-rejected'])(
        'a %s error from the recovery host is a recovery failure, even after a heartbeat and other acks',
        (code) => {
          const ctx = setup();
          const { watcher, hosts, clock, record, degradations, diagnostics } =
            ctx;
          watcher.watch(ROOT, options(), record().listener);
          watcher.watch('/other', options(), record().listener);
          degrade(ctx);
          clock.advance(RECOVERY_MS);

          hosts[6].heartbeat();
          hosts[6].send({ type: 'subscribed', id: 1 });
          hosts[6].send({ type: 'error', code, message: 'ENOENT' });

          expect(hosts[6].kill).toHaveBeenCalledTimes(1);
          expect(watcher.isDegraded).toBe(true);
          expect(withMessage(diagnostics, RECOVERED)).toHaveLength(0);
          expect(withMessage(diagnostics, RECOVERY_FAILED)).toEqual([
            expect.objectContaining({
              detail: expect.objectContaining({
                reason: 'recovery-subscribe-failed',
                detail: code,
              }),
            }),
          ]);
          // A late ack from the killed host changes nothing.
          hosts[6].send({ type: 'subscribed', id: 2 });
          clock.advance(10_000);
          expect(watcher.isDegraded).toBe(true);
          expect(degradations).toHaveLength(1);
          watcher.dispose();
          expect(clock.pendingTimers).toBe(0);
        },
      );

      it('partial acks at the deadline are a failure; a subscription disposed while awaited no longer blocks', () => {
        const ctx = setup();
        const { watcher, hosts, clock, record, diagnostics } = ctx;
        watcher.watch(ROOT, options(), record().listener);
        const second = watcher.watch('/other', options(), record().listener);
        degrade(ctx);

        // First attempt: one ack of two by the deadline.
        clock.advance(RECOVERY_MS);
        hosts[6].send({ type: 'subscribed', id: 1 });
        advanceAlive(clock, hosts[6], 6_000);
        expect(hosts[6].kill).toHaveBeenCalledTimes(1);
        expect(withMessage(diagnostics, RECOVERY_FAILED)).toHaveLength(1);

        // Second attempt: the unacked subscription goes away, which completes it.
        clock.advance(RECOVERY_MS);
        expect(hosts).toHaveLength(8);
        hosts[7].send({ type: 'subscribed', id: 1 });
        expect(watcher.isDegraded).toBe(true);
        second.dispose();
        expect(watcher.isDegraded).toBe(false);
        expect(withMessage(diagnostics, RECOVERED)).toHaveLength(1);
        advanceAlive(clock, hosts[7], 60_000);
        expect(hosts[7].kill).not.toHaveBeenCalled();
        watcher.dispose();
      });

      it('a failed recovery returns to degraded for another 10 minutes without a second report', () => {
        const ctx = setup();
        const { watcher, hosts, clock, record, degradations, diagnostics } =
          ctx;
        const rec = record();
        watcher.watch(ROOT, options(), rec.listener);
        degrade(ctx);

        clock.advance(RECOVERY_MS);
        expect(hosts).toHaveLength(7);
        hosts[6].exit(1);
        expect(hosts[6].kill).toHaveBeenCalledTimes(1);
        expect(watcher.isDegraded).toBe(true);

        // Nothing forks inside the next 10 minutes.
        clock.advance(RECOVERY_MS - 1);
        expect(hosts).toHaveLength(7);
        clock.advance(1);
        expect(hosts).toHaveLength(8);

        // A silent recovery host fails at the ack deadline, same outcome.
        clock.advance(8_000);
        expect(hosts[7].kill).toHaveBeenCalledTimes(1);
        expect(watcher.isDegraded).toBe(true);

        // Rescans continued the whole time and still do.
        const overflows = overflowCount(rec.batches);
        clock.advance(60_000);
        expect(overflowCount(rec.batches)).toBe(overflows + 1);

        expect(degradations).toHaveLength(1);
        expect(
          diagnostics.filter(
            (d) =>
              d.message === '[WorkspaceWatcher] degraded host recovery failed',
          ),
        ).toHaveLength(2);
        expect(
          diagnostics.filter(
            (d) => d.message === '[WorkspaceWatcher] host degraded',
          ),
        ).toHaveLength(1);
        watcher.dispose();
        expect(clock.pendingTimers).toBe(0);
      });

      it('dispose during a recovery attempt leaves no timer and no host', () => {
        const ctx = setup();
        const { watcher, hosts, clock, record } = ctx;
        watcher.watch(ROOT, options(), record().listener);
        degrade(ctx);

        clock.advance(RECOVERY_MS);
        expect(hosts).toHaveLength(7);
        watcher.dispose();

        expect(hosts[6].kill).toHaveBeenCalledTimes(1);
        expect(clock.pendingTimers).toBe(0);
        clock.advance(RECOVERY_MS * 3);
        expect(hosts).toHaveLength(7);
      });
    });

    it('failures older than the 10-minute window do not count against the budget', () => {
      const { watcher, hosts, clock, record } = setup();
      watcher.watch(ROOT, options(), record().listener);
      for (let failure = 1; failure <= 5; failure++) {
        hosts[hosts.length - 1].exit(1);
        clock.advance(250);
        hosts[hosts.length - 1].heartbeat();
      }
      for (let i = 0; i < 301; i++) {
        clock.advance(2_000);
        hosts[hosts.length - 1].heartbeat();
      }
      hosts[hosts.length - 1].exit(1);
      clock.advance(250);
      expect(watcher.isDegraded).toBe(false);
      expect(hosts).toHaveLength(7);
      watcher.dispose();
    });

    it('a throwing degradation sink is reported, not propagated', () => {
      const clock = new ManualClock();
      const hosts: FakeHostProcess[] = [];
      const diagnostics: WorkspaceWatcherDiagnostic[] = [];
      const watcher = new WorkspaceWatchSupervisor({
        host: {
          fork: () => {
            const host = new FakeHostProcess();
            hosts.push(host);
            return host;
          },
        },
        clock,
        supervision: { restartBudget: 0 },
        onDiagnostic: (d) => diagnostics.push(d),
        onDegraded: () => {
          throw new Error('reporter down');
        },
      });
      watcher.watch(ROOT, options(), () => undefined);
      expect(() => hosts[0].exit(1)).not.toThrow();
      expect(watcher.isDegraded).toBe(true);
      expect(diagnostics).toContainEqual(
        expect.objectContaining({
          message: '[WorkspaceWatcher] degradation report failed',
        }),
      );
      watcher.dispose();
    });
  });
});

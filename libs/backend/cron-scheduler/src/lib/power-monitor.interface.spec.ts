/**
 * NoopPowerMonitor — the default `IPowerMonitor` for hosts with no power API.
 *
 * `isOnBattery()` is the gate for battery-aware work (skill-synthesis drain).
 * A host that cannot observe battery state must report `false`, otherwise the
 * VS Code and CLI hosts would permanently skip that work.
 */
import { NoopPowerMonitor } from './power-monitor.interface';
import type { IPowerMonitor } from './power-monitor.interface';

describe('NoopPowerMonitor', () => {
  let monitor: IPowerMonitor;

  beforeEach(() => {
    monitor = new NoopPowerMonitor();
  });

  it('reports not-on-battery', () => {
    expect(monitor.isOnBattery()).toBe(false);
  });

  it('reports not-on-battery on every call', () => {
    expect(monitor.isOnBattery()).toBe(false);
    expect(monitor.isOnBattery()).toBe(false);
  });

  it('never invokes a resume subscriber', () => {
    const cb = jest.fn();

    const dispose = monitor.onResume(cb);

    expect(cb).not.toHaveBeenCalled();
    expect(typeof dispose).toBe('function');
  });

  it('never invokes a suspend subscriber', () => {
    const cb = jest.fn();

    const dispose = monitor.onSuspend(cb);

    expect(cb).not.toHaveBeenCalled();
    expect(typeof dispose).toBe('function');
  });

  it('tolerates repeated disposal', () => {
    const disposeResume = monitor.onResume(jest.fn());
    const disposeSuspend = monitor.onSuspend(jest.fn());

    expect(() => {
      disposeResume();
      disposeResume();
      disposeSuspend();
      disposeSuspend();
    }).not.toThrow();
  });
});

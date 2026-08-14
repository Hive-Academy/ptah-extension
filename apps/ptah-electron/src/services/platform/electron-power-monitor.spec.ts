/**
 * ElectronPowerMonitor — asserts the adapter defers to `electron.powerMonitor`
 * and nothing else: subscriptions attach/detach the exact listener they own,
 * disposal is idempotent, and `isOnBattery()` is a live read of
 * `isOnBatteryPower()` (not a value cached at construction).
 */
jest.mock('electron', () => ({
  powerMonitor: {
    on: jest.fn(),
    off: jest.fn(),
    isOnBatteryPower: jest.fn(() => false),
  },
}));

import { powerMonitor } from 'electron';
import { ElectronPowerMonitor } from './electron-power-monitor';

const on = powerMonitor.on as unknown as jest.Mock;
const off = powerMonitor.off as unknown as jest.Mock;
const isOnBatteryPower = powerMonitor.isOnBatteryPower as unknown as jest.Mock;

/** Invokes the listener the adapter registered for `event`. */
function emit(event: string): void {
  const call = on.mock.calls.find(([name]) => name === event);
  if (!call) throw new Error(`no listener registered for '${event}'`);
  (call[1] as () => void)();
}

describe('ElectronPowerMonitor', () => {
  let monitor: ElectronPowerMonitor;

  beforeEach(() => {
    on.mockClear();
    off.mockClear();
    isOnBatteryPower.mockClear();
    isOnBatteryPower.mockReturnValue(false);
    monitor = new ElectronPowerMonitor();
  });

  describe('isOnBattery', () => {
    it('returns true when Electron reports battery power', () => {
      isOnBatteryPower.mockReturnValue(true);

      expect(monitor.isOnBattery()).toBe(true);
    });

    it('returns false when Electron reports mains power', () => {
      isOnBatteryPower.mockReturnValue(false);

      expect(monitor.isOnBattery()).toBe(false);
    });

    it('reads live state on every call rather than caching', () => {
      isOnBatteryPower.mockReturnValue(false);
      expect(monitor.isOnBattery()).toBe(false);

      isOnBatteryPower.mockReturnValue(true);
      expect(monitor.isOnBattery()).toBe(true);

      expect(isOnBatteryPower).toHaveBeenCalledTimes(2);
    });

    it('registers no listeners', () => {
      monitor.isOnBattery();

      expect(on).not.toHaveBeenCalled();
    });
  });

  describe('onResume', () => {
    it('invokes the callback on a resume event', () => {
      const cb = jest.fn();
      monitor.onResume(cb);

      emit('resume');

      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('detaches the same listener it attached on dispose', () => {
      const dispose = monitor.onResume(jest.fn());
      const [, attached] = on.mock.calls[0];

      dispose();

      expect(off).toHaveBeenCalledWith('resume', attached);
    });

    it('ignores repeated disposal', () => {
      const dispose = monitor.onResume(jest.fn());

      dispose();
      dispose();

      expect(off).toHaveBeenCalledTimes(1);
    });
  });

  describe('onSuspend', () => {
    it('invokes the callback on a suspend event', () => {
      const cb = jest.fn();
      monitor.onSuspend(cb);

      emit('suspend');

      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('detaches the same listener it attached on dispose', () => {
      const dispose = monitor.onSuspend(jest.fn());
      const [, attached] = on.mock.calls[0];

      dispose();

      expect(off).toHaveBeenCalledWith('suspend', attached);
    });

    it('ignores repeated disposal', () => {
      const dispose = monitor.onSuspend(jest.fn());

      dispose();
      dispose();

      expect(off).toHaveBeenCalledTimes(1);
    });
  });
});

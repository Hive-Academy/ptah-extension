/**
 * LoggingService unit specs.
 *
 * Strategy: Create the service via TestBed. Mock window globals for
 * environment initialization tests. Spy on console methods to verify
 * correct routing per log level.
 */

import { TestBed } from '@angular/core/testing';
import { LoggingService, LogLevel } from './logging.service';

interface PtahDebugWindow extends Window {
  PTAH_DEBUG_LOGGING?: boolean;
  PTAH_LOG_LEVEL?: string;
}

function getPtahDebugWindow(): PtahDebugWindow {
  return window as unknown as PtahDebugWindow;
}

describe('LoggingService', () => {
  let service: LoggingService;
  let consoleDebugSpy: jest.SpyInstance;
  let consoleInfoSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    // Suppress console output during tests
    consoleDebugSpy = jest
      .spyOn(console, 'debug')
      .mockImplementation(() => undefined);
    consoleInfoSpy = jest
      .spyOn(console, 'info')
      .mockImplementation(() => undefined);
    consoleWarnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    // Clean up any window debug flags
    delete getPtahDebugWindow().PTAH_DEBUG_LOGGING;
    delete getPtahDebugWindow().PTAH_LOG_LEVEL;
  });

  afterEach(() => {
    consoleDebugSpy.mockRestore();
    consoleInfoSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    delete getPtahDebugWindow().PTAH_DEBUG_LOGGING;
    delete getPtahDebugWindow().PTAH_LOG_LEVEL;
    TestBed.resetTestingModule();
  });

  function createService(): LoggingService {
    TestBed.configureTestingModule({ providers: [LoggingService] });
    return TestBed.inject(LoggingService);
  }

  // ── Initial state ─────────────────────────────────────────────────────────

  it('initializes with INFO level by default', () => {
    service = createService();
    expect(service.currentLevel()).toBe(LogLevel.INFO);
  });

  it('getConfig() returns defaults matching INFO level', () => {
    service = createService();
    const config = service.getConfig();
    expect(config.level).toBe(LogLevel.INFO);
    expect(config.enableConsole).toBe(true);
    expect(config.maxHistorySize).toBe(1000);
  });

  // ── initializeFromEnvironment ─────────────────────────────────────────────

  describe('initializeFromEnvironment()', () => {
    it('uses INFO level when no window flags are set', () => {
      service = createService();
      expect(service.currentLevel()).toBe(LogLevel.INFO);
    });

    it('sets DEBUG level when window.PTAH_DEBUG_LOGGING=true', () => {
      getPtahDebugWindow().PTAH_DEBUG_LOGGING = true;
      service = createService();
      expect(service.currentLevel()).toBe(LogLevel.DEBUG);
    });

    it('sets WARN level from window.PTAH_LOG_LEVEL="WARN"', () => {
      getPtahDebugWindow().PTAH_LOG_LEVEL = 'WARN';
      service = createService();
      expect(service.currentLevel()).toBe(LogLevel.WARN);
    });

    it('sets ERROR level from window.PTAH_LOG_LEVEL="ERROR"', () => {
      getPtahDebugWindow().PTAH_LOG_LEVEL = 'ERROR';
      service = createService();
      expect(service.currentLevel()).toBe(LogLevel.ERROR);
    });

    it('ignores invalid PTAH_LOG_LEVEL and stays at INFO', () => {
      getPtahDebugWindow().PTAH_LOG_LEVEL = 'INVALID_LEVEL';
      service = createService();
      expect(service.currentLevel()).toBe(LogLevel.INFO);
    });

    it('PTAH_DEBUG_LOGGING takes precedence over PTAH_LOG_LEVEL', () => {
      getPtahDebugWindow().PTAH_DEBUG_LOGGING = true;
      getPtahDebugWindow().PTAH_LOG_LEVEL = 'WARN';
      service = createService();
      // Debug flag is checked first and short-circuits
      expect(service.currentLevel()).toBe(LogLevel.DEBUG);
    });
  });

  // ── setLogLevel ───────────────────────────────────────────────────────────

  it('setLogLevel() updates the currentLevel signal', () => {
    service = createService();
    service.setLogLevel(LogLevel.WARN);
    expect(service.currentLevel()).toBe(LogLevel.WARN);
  });

  // ── setConsoleEnabled ─────────────────────────────────────────────────────

  it('setConsoleEnabled(false) disables console output', () => {
    service = createService();
    service.setConsoleEnabled(false);
    consoleInfoSpy.mockClear();

    service.info('Test', 'Should not print');

    expect(consoleInfoSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('Should not print'),
      expect.anything(),
      expect.anything(),
    );
    expect(service.getConfig().enableConsole).toBe(false);
  });

  it('setConsoleEnabled(true) re-enables console output', () => {
    service = createService();
    service.setConsoleEnabled(false);
    service.setConsoleEnabled(true);
    consoleInfoSpy.mockClear();

    service.info('Test', 'Should print');

    expect(consoleInfoSpy).toHaveBeenCalled();
    expect(service.getConfig().enableConsole).toBe(true);
  });

  // ── log level filtering ───────────────────────────────────────────────────

  describe('log level filtering', () => {
    it('debug() is filtered out when level is INFO (default)', () => {
      service = createService();
      consoleDebugSpy.mockClear();

      service.debug('Test', 'Debug message');

      expect(consoleDebugSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Debug message'),
        expect.anything(),
        expect.anything(),
      );
      // Confirm no history entry added for filtered message
      expect(service.getRecentLogs(1)).toHaveLength(0);
    });

    it('debug() passes through when level is set to DEBUG', () => {
      getPtahDebugWindow().PTAH_DEBUG_LOGGING = true;
      service = createService();
      consoleDebugSpy.mockClear();

      service.debug('Test', 'Debug message');

      expect(consoleDebugSpy).toHaveBeenCalled();
      expect(service.getRecentLogs(1)).toHaveLength(1);
    });

    it('info() passes through at INFO level', () => {
      service = createService();
      consoleInfoSpy.mockClear();

      service.info('Test', 'Info message');

      expect(consoleInfoSpy).toHaveBeenCalled();
      expect(service.getRecentLogs(1)).toHaveLength(1);
      expect(service.getRecentLogs(1)[0].message).toBe('Info message');
    });

    it('warn() passes through at INFO level', () => {
      service = createService();
      consoleWarnSpy.mockClear();

      service.warn('Test', 'Warn message');

      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('error() always passes through', () => {
      service = createService();
      consoleErrorSpy.mockClear();

      service.error('Test', 'Error message');

      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('message below current level is NOT added to history', () => {
      service = createService(); // INFO level
      service.debug('Test', 'filtered');
      expect(service.getRecentLogs(10)).toHaveLength(0);
    });
  });

  // ── history size limit ────────────────────────────────────────────────────

  it('history shifts oldest entry when exceeding maxHistorySize (1000)', () => {
    service = createService();

    // Log 1001 entries
    for (let i = 0; i <= 1000; i++) {
      service.info('Test', `msg-${i}`);
    }

    const logs = service.getRecentLogs(10000);
    // Should have exactly 1000 entries
    expect(logs).toHaveLength(1000);
    // The oldest (msg-0) should have been shifted out
    expect(logs[0].message).toBe('msg-1');
    // The newest should still be present
    expect(logs[logs.length - 1].message).toBe('msg-1000');
  });

  // ── logToConsole routing ──────────────────────────────────────────────────

  describe('logToConsole routing per level', () => {
    beforeEach(() => {
      getPtahDebugWindow().PTAH_DEBUG_LOGGING = true;
    });

    it('routes DEBUG entries to console.debug', () => {
      service = createService();
      consoleDebugSpy.mockClear();

      service.debug('Ctx', 'debug msg', { x: 1 });

      expect(consoleDebugSpy).toHaveBeenCalled();
    });

    it('routes INFO entries to console.info', () => {
      service = createService();
      consoleInfoSpy.mockClear();

      service.info('Ctx', 'info msg');

      expect(consoleInfoSpy).toHaveBeenCalled();
    });

    it('routes WARN entries to console.warn', () => {
      service = createService();
      consoleWarnSpy.mockClear();

      service.warn('Ctx', 'warn msg');

      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('routes ERROR entries to console.error', () => {
      service = createService();
      consoleErrorSpy.mockClear();

      service.error('Ctx', 'error msg');

      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  // ── getRecentLogs ─────────────────────────────────────────────────────────

  it('getRecentLogs(N) returns last N entries', () => {
    service = createService();
    service.info('Test', 'msg-1');
    service.info('Test', 'msg-2');
    service.info('Test', 'msg-3');

    const recent = service.getRecentLogs(2);
    expect(recent).toHaveLength(2);
    expect(recent[0].message).toBe('msg-2');
    expect(recent[1].message).toBe('msg-3');
  });

  // ── getLogsByLevel ────────────────────────────────────────────────────────

  it('getLogsByLevel() filters by exact level', () => {
    service = createService();
    service.info('Test', 'info-msg');
    service.warn('Test', 'warn-msg');
    service.error('Test', 'error-msg');

    const warnLogs = service.getLogsByLevel(LogLevel.WARN);
    expect(warnLogs).toHaveLength(1);
    expect(warnLogs[0].message).toBe('warn-msg');
  });

  // ── getLogsByContext ──────────────────────────────────────────────────────

  it('getLogsByContext() filters by context substring', () => {
    service = createService();
    service.info('MyComponent', 'component log');
    service.info('OtherService', 'other log');
    service.info('MyService', 'service log');

    const myLogs = service.getLogsByContext('My');
    expect(myLogs).toHaveLength(2);
  });

  // ── clearHistory ──────────────────────────────────────────────────────────

  it('clearHistory() empties the log history', () => {
    service = createService();
    service.info('Test', 'msg-1');
    service.info('Test', 'msg-2');
    expect(service.getRecentLogs(100)).toHaveLength(2);

    service.clearHistory();

    expect(service.getRecentLogs(100)).toHaveLength(0);
  });

  // ── exportLogs ────────────────────────────────────────────────────────────

  it('exportLogs() returns valid JSON string', () => {
    service = createService();
    service.info('Test', 'msg-1');
    service.warn('Test', 'msg-2');

    const exported = service.exportLogs();
    const parsed = JSON.parse(exported);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].message).toBe('msg-1');
  });

  it('exportLogs() returns empty array JSON when no logs', () => {
    service = createService();
    const exported = service.exportLogs();
    expect(JSON.parse(exported)).toEqual([]);
  });

  // ── Convenience methods ───────────────────────────────────────────────────

  describe('convenience logging methods', () => {
    beforeEach(() => {
      getPtahDebugWindow().PTAH_DEBUG_LOGGING = true; // Enable DEBUG so lifecycle/service/performance pass through
    });

    it('lifecycle() delegates to debug with [Lifecycle] prefix', () => {
      service = createService();
      consoleDebugSpy.mockClear();

      service.lifecycle('MyComponent', 'ngOnInit');

      expect(consoleDebugSpy).toHaveBeenCalled();
      const logs = service.getRecentLogs(1);
      expect(logs[0].context).toContain('Lifecycle');
      expect(logs[0].context).toContain('MyComponent');
    });

    it('service() delegates to debug with [Service] prefix', () => {
      service = createService();
      consoleDebugSpy.mockClear();

      service.service('MyService', 'doSomething');

      const logs = service.getRecentLogs(1);
      expect(logs[0].context).toContain('Service');
      expect(logs[0].context).toContain('MyService');
    });

    it('interaction() delegates to info with [Interaction] prefix', () => {
      service = createService();
      consoleInfoSpy.mockClear();

      service.interaction('Button', 'clicked');

      const logs = service.getRecentLogs(1);
      expect(logs[0].context).toContain('Interaction');
      expect(logs[0].level).toBe(LogLevel.INFO);
    });

    it('performance() delegates to debug with [Performance] prefix and ms data', () => {
      service = createService();
      consoleDebugSpy.mockClear();

      service.performance('Render', 'time', 42);

      const logs = service.getRecentLogs(1);
      expect(logs[0].context).toContain('Performance');
      expect(logs[0].data).toEqual({ value: 42, unit: 'ms' });
    });

    it('api() delegates to debug with [API] prefix', () => {
      service = createService();
      consoleDebugSpy.mockClear();

      service.api('sent', 'RPC_CALL', { method: 'test' });

      const logs = service.getRecentLogs(1);
      expect(logs[0].context).toContain('API');
      expect(logs[0].context).toContain('sent');
    });
  });

  // ── LogEntry structure ────────────────────────────────────────────────────

  it('log entries include timestamp, level, context, message, and optional data', () => {
    service = createService();
    service.info('TestContext', 'Test message', { key: 'value' });

    const logs = service.getRecentLogs(1);
    expect(logs[0].timestamp).toBeInstanceOf(Date);
    expect(logs[0].level).toBe(LogLevel.INFO);
    expect(logs[0].context).toBe('TestContext');
    expect(logs[0].message).toBe('Test message');
    expect(logs[0].data).toEqual({ key: 'value' });
  });
});

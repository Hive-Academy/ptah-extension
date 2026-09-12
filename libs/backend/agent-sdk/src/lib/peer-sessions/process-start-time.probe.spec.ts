import {
  POSIX_START_TIME_TOLERANCE_MS,
  ProcessStartTimeProbe,
  WINDOWS_START_TIME_TOLERANCE_MS,
  buildWindowsProbeScript,
  decodeStartFingerprint,
  parsePosixProbeOutput,
  parseWindowsProbeOutput,
} from './process-start-time.probe';

/**
 * The three live records measured on 2026-09-12, with the OS start time
 * `Get-Process().StartTime` reported for the same pid in the same minute.
 * These pin the encoding claim the module's doc block makes; if the CLI ever
 * changes it, this table is what fails first.
 */
const MEASURED = [
  { pid: 16288, procStart: '134336784461747472', osStartMs: 1789204846174 },
  { pid: 18332, procStart: '134336790403055566', osStartMs: 1789205440305 },
  { pid: 34304, procStart: '134336784594484427', osStartMs: 1789204859448 },
] as const;

/** A "now" close enough to the measured records to be inside the sanity window. */
const MEASURED_NOW = 1789205500000;

describe('decodeStartFingerprint', () => {
  it.each(MEASURED)(
    'decodes pid $pid to the OS start time, exactly',
    ({ procStart, osStartMs }) => {
      expect(decodeStartFingerprint(procStart, MEASURED_NOW)).toBe(osStartMs);
    },
  );

  it('decodes a plain epoch-millisecond fingerprint through the fallback', () => {
    expect(decodeStartFingerprint('1789205000000', MEASURED_NOW)).toBe(
      1789205000000,
    );
  });

  it.each([
    ['not a number', 'abc'],
    ['empty', ''],
    ['negative', '-1'],
    ['fractional', '1.5'],
  ])('returns null for %s rather than guessing', (_label, value) => {
    expect(decodeStartFingerprint(value, MEASURED_NOW)).toBeNull();
  });

  it('returns null when no encoding places the value near the present', () => {
    // Small enough to be neither a plausible FILETIME nor a plausible epoch ms.
    expect(decodeStartFingerprint('12345', MEASURED_NOW)).toBeNull();
  });

  it('returns null for a FILETIME far in the past rather than reporting it', () => {
    // The same record read 10 years later must not decode to a live process.
    const tenYearsOn = MEASURED_NOW + 10 * 365 * 24 * 60 * 60 * 1000;
    expect(decodeStartFingerprint(MEASURED[0].procStart, tenYearsOn)).toBeNull();
  });
});

describe('parseWindowsProbeOutput', () => {
  it('reads the pid/epoch-ms pairs the probe script emits', () => {
    const parsed = parseWindowsProbeOutput(
      '16288 1789204846174\r\n34304 1789204859448\r\n',
    );
    expect(parsed.get(16288)).toBe(1789204846174);
    expect(parsed.get(34304)).toBe(1789204859448);
    expect(parsed.size).toBe(2);
  });

  it('ignores noise lines instead of inventing entries', () => {
    const parsed = parseWindowsProbeOutput(
      'Get-Process : Cannot find a process\n16288 1789204846174\n\n',
    );
    expect([...parsed.keys()]).toEqual([16288]);
  });
});

describe('parsePosixProbeOutput', () => {
  it('reads `ps -o pid=,lstart=` output', () => {
    const parsed = parsePosixProbeOutput(' 1234 Fri Sep 12 12:20:46 2026\n');
    expect(parsed.get(1234)).toBe(Date.parse('Fri Sep 12 12:20:46 2026'));
  });

  it('skips a row whose time does not parse', () => {
    expect(parsePosixProbeOutput(' 1234 not a date at all\n').size).toBe(0);
  });
});

describe('buildWindowsProbeScript', () => {
  it('asks for every pid in one call', () => {
    expect(buildWindowsProbeScript([1, 2, 3])).toContain('-Id 1,2,3');
  });

  it('guards each StartTime read so one protected pid cannot lose the batch', () => {
    expect(buildWindowsProbeScript([1])).toContain('try {');
  });
});

describe('ProcessStartTimeProbe', () => {
  it('runs one command for many pids and reports each', async () => {
    const run = jest
      .fn()
      .mockResolvedValue('16288 1789204846174\n34304 1789204859448\n');
    const probe = new ProcessStartTimeProbe({ platform: 'win32', run });

    const result = await probe.probe([16288, 34304, 16288]);

    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toBe('powershell.exe');
    expect(result.get(16288)).toBe(1789204846174);
    expect(result.get(34304)).toBe(1789204859448);
  });

  it('reports a pid the OS did not return as null — not running', async () => {
    const probe = new ProcessStartTimeProbe({
      platform: 'win32',
      run: jest.fn().mockResolvedValue('16288 1789204846174\n'),
    });

    const result = await probe.probe([16288, 2832]);

    expect(result.get(2832)).toBeNull();
    expect(result.has(2832)).toBe(true);
  });

  it('returns an EMPTY map when the probe itself fails, not a map of nulls', async () => {
    const probe = new ProcessStartTimeProbe({
      platform: 'win32',
      run: jest.fn().mockRejectedValue(new Error('powershell missing')),
    });

    const result = await probe.probe([16288]);

    // Empty is what keeps "could not check" distinguishable from "not
    // running" all the way to the row's reason code.
    expect(result.size).toBe(0);
  });

  it('uses ps on a POSIX platform', async () => {
    const run = jest.fn().mockResolvedValue(' 42 Fri Sep 12 12:20:46 2026\n');
    const probe = new ProcessStartTimeProbe({ platform: 'linux', run });

    await probe.probe([42]);

    expect(run.mock.calls[0][0]).toBe('ps');
  });

  it('is unsupported on a platform with no probe, and probes nothing there', async () => {
    const run = jest.fn();
    const probe = new ProcessStartTimeProbe({ platform: 'aix', run });

    expect(probe.supported).toBe(false);
    expect((await probe.probe([1])).size).toBe(0);
    expect(run).not.toHaveBeenCalled();
  });

  it('runs nothing when asked for no pids', async () => {
    const run = jest.fn();
    await new ProcessStartTimeProbe({ platform: 'win32', run }).probe([]);
    expect(run).not.toHaveBeenCalled();
  });

  it('drops non-positive pids before asking the OS about them', async () => {
    const run = jest.fn().mockResolvedValue('');
    await new ProcessStartTimeProbe({ platform: 'win32', run }).probe([
      0, -1, 7,
    ]);
    expect(run.mock.calls[0][1][3]).toContain('-Id 7');
  });

  it('widens the tolerance on POSIX, where lstart has second granularity', () => {
    expect(new ProcessStartTimeProbe({ platform: 'win32' }).toleranceMs).toBe(
      WINDOWS_START_TIME_TOLERANCE_MS,
    );
    expect(new ProcessStartTimeProbe({ platform: 'linux' }).toleranceMs).toBe(
      POSIX_START_TIME_TOLERANCE_MS,
    );
  });
});

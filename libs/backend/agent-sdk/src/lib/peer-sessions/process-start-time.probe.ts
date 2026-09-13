/**
 * PID-recycle-safe liveness for peer sessions (TASK_2026_402, Task 10.2).
 *
 * ## Why a bare `pid` check is not acceptable here
 *
 * Windows recycles pids, and a registry record outlives the process that wrote
 * it whenever the CLI dies without cleaning up. `process.kill(pid, 0)` would
 * then report an unrelated program as a live Claude session, and the user would
 * be offered a peer that cannot receive anything — the exact "offered as if it
 * works" failure Requirement 10 criterion 3 forbids. The CLI itself guards this
 * the same way, comparing a stored start fingerprint against the current
 * process's (`research-report-addressing.md`, `requireLiveOwner`); this is the
 * same comparison built from the same two fields.
 *
 * ## The encoding, measured rather than assumed
 *
 * The research report left `procStart`'s units and epoch unconfirmed. They are
 * confirmed here. On Windows, `procStart` is a Windows `FILETIME`: 100-ns ticks
 * since 1601-01-01 UTC. Measured 2026-09-12 against `Get-Process().StartTime`
 * on three live records, exact to the millisecond every time:
 *
 * | pid   | record `procStart`   | decoded epoch ms | OS start time |
 * | ----- | -------------------- | ---------------- | ------------- |
 * | 16288 | 134336784461747472   | 1789204846174    | 1789204846174 |
 * | 18332 | 134336790403055566   | 1789205440305    | 1789205440305 |
 * | 34304 | 134336784594484427   | 1789204859448    | 1789204859448 |
 *
 * A fourth record (pid 2832, CLI 2.1.233) named a pid that no longer exists —
 * the stale-record case this whole module exists for.
 *
 * The epoch-millisecond fallback below is NOT measured. It is the obvious other
 * shape (the same record's `startedAt` uses it) and is kept so a future
 * non-Windows build that stores plain milliseconds is readable. If it decodes
 * wrong, the comparison fails and the row reads `liveness-unverified` — the
 * safe direction, never a false reachable.
 */

import crossSpawn from 'cross-spawn';

/**
 * Difference between the 1601-01-01 FILETIME epoch and the 1970-01-01 Unix
 * epoch, in milliseconds.
 */
const FILETIME_EPOCH_OFFSET_MS = 11_644_473_600_000n;

/** FILETIME ticks per millisecond (one tick is 100 ns). */
const FILETIME_TICKS_PER_MS = 10_000n;

/**
 * A decoded fingerprint outside this window around "now" is treated as a
 * failed decode rather than a real timestamp. It is what stops a wrong
 * encoding guess from being mistaken for a plausible start time.
 */
const DECODE_PAST_WINDOW_MS = 400 * 24 * 60 * 60 * 1000;
const DECODE_FUTURE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * How far the decoded fingerprint may sit from the OS-reported start time and
 * still count as the same process.
 *
 * Windows matched to the millisecond in every measurement, so 1 s is pure
 * slack. POSIX `ps -o lstart=` prints whole seconds, so 2 s is the smallest
 * value that cannot produce a false mismatch from rounding alone.
 */
export const WINDOWS_START_TIME_TOLERANCE_MS = 1_000;
export const POSIX_START_TIME_TOLERANCE_MS = 2_000;

/** pid → OS start time in epoch ms, or `null` when the pid is not running. */
export type ProcessStartTimes = ReadonlyMap<number, number | null>;

/**
 * Runs a command and returns its stdout. Injected so the parsers can be tested
 * without a real process, and so a host can supply its own runner.
 */
export type ProbeCommandRunner = (
  command: string,
  args: readonly string[],
) => Promise<string>;

/**
 * Decode a registry start fingerprint to epoch milliseconds.
 *
 * Returns `null` when the value is not a non-negative integer string, or when
 * no supported encoding places it near the present. `null` means "this build
 * cannot establish liveness from this value" and must surface as
 * `liveness-unverified`, never as reachable.
 */
export function decodeStartFingerprint(
  fingerprint: string,
  now: number = Date.now(),
): number | null {
  const trimmed = fingerprint.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const raw = BigInt(trimmed);

  // Measured encoding: Windows FILETIME.
  const asFileTime = Number(
    raw / FILETIME_TICKS_PER_MS - FILETIME_EPOCH_OFFSET_MS,
  );
  if (isPlausible(asFileTime, now)) {
    return asFileTime;
  }

  // Unmeasured fallback: plain epoch milliseconds. See the module note.
  const asEpochMs = Number(raw);
  if (isPlausible(asEpochMs, now)) {
    return asEpochMs;
  }

  return null;
}

function isPlausible(candidate: number, now: number): boolean {
  return (
    Number.isFinite(candidate) &&
    candidate > now - DECODE_PAST_WINDOW_MS &&
    candidate < now + DECODE_FUTURE_WINDOW_MS
  );
}

/**
 * Parse the `"<pid> <epochMs>"` lines the Windows probe script emits.
 *
 * A line whose start time could not be read is simply absent from the script's
 * output, and therefore absent from this map — which the caller reports as
 * unverified rather than as "not running".
 */
export function parseWindowsProbeOutput(stdout: string): Map<number, number> {
  const result = new Map<number, number>();
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (!match) {
      continue;
    }
    result.set(Number(match[1]), Number(match[2]));
  }
  return result;
}

/**
 * Parse `ps -o pid=,lstart=` output, e.g. `" 1234 Fri Sep 12 12:20:46 2026"`.
 *
 * `lstart` is a locale-formatted absolute time with second granularity, which
 * is why {@link POSIX_START_TIME_TOLERANCE_MS} is wider than the Windows one.
 */
export function parsePosixProbeOutput(stdout: string): Map<number, number> {
  const result = new Map<number, number>();
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\S.*\S)\s*$/.exec(line);
    if (!match) {
      continue;
    }
    const parsed = Date.parse(match[2]);
    if (Number.isNaN(parsed)) {
      continue;
    }
    result.set(Number(match[1]), parsed);
  }
  return result;
}

/**
 * The PowerShell one-liner the Windows probe runs.
 *
 * Passed as a single `-Command` argument through `cross-spawn` with an
 * argument list and no `shell` option — the source guard in
 * `no-shell-spawn.guard.spec.ts` rejects the alternative, and a shell here
 * would concatenate pids into a command line unescaped.
 *
 * `StartTime` throws for a process this user may not inspect, so each read is
 * guarded individually: one protected pid must not cost the whole batch.
 */
export function buildWindowsProbeScript(pids: readonly number[]): string {
  return (
    `foreach ($p in Get-Process -Id ${pids.join(',')} ` +
    `-ErrorAction SilentlyContinue) { try { ` +
    `"$($p.Id) $([int64]([datetimeoffset]$p.StartTime).ToUnixTimeMilliseconds())" ` +
    `} catch { } }`
  );
}

/**
 * Reads OS process start times so a registry fingerprint can be checked
 * against the process that is actually holding the pid now.
 */
export class ProcessStartTimeProbe {
  private readonly platform: string;
  private readonly run: ProbeCommandRunner;

  constructor(options?: {
    readonly platform?: string;
    readonly run?: ProbeCommandRunner;
  }) {
    this.platform = options?.platform ?? process.platform;
    this.run = options?.run ?? runCommand;
  }

  /** True when this platform has a probe at all. */
  get supported(): boolean {
    return this.platform === 'win32' || hasPosixPs(this.platform);
  }

  /** Match tolerance for this platform, in milliseconds. */
  get toleranceMs(): number {
    return this.platform === 'win32'
      ? WINDOWS_START_TIME_TOLERANCE_MS
      : POSIX_START_TIME_TOLERANCE_MS;
  }

  /**
   * Start times for the given pids, in ONE command rather than one per pid.
   *
   * A pid the probe did not report back is `null` — not running, as far as
   * this host can tell. If the probe itself fails or the platform has none,
   * the map is EMPTY, which the caller must distinguish from `null`: empty
   * means "nothing was established", and every row becomes
   * `liveness-unverified`.
   */
  async probe(pids: readonly number[]): Promise<ProcessStartTimes> {
    const unique = [...new Set(pids)].filter(
      (pid) => Number.isInteger(pid) && pid > 0,
    );
    if (unique.length === 0 || !this.supported) {
      return new Map();
    }

    try {
      const observed =
        this.platform === 'win32'
          ? parseWindowsProbeOutput(
              await this.run('powershell.exe', [
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                buildWindowsProbeScript(unique),
              ]),
            )
          : parsePosixProbeOutput(
              await this.run('ps', ['-o', 'pid=,lstart=', '-p', unique.join(',')]),
            );

      const result = new Map<number, number | null>();
      for (const pid of unique) {
        result.set(pid, observed.get(pid) ?? null);
      }
      return result;
    } catch {
      // A failed probe establishes nothing. Returning an empty map — rather
      // than a map of nulls — is what keeps "we could not check" distinct from
      // "it is not running" all the way to the row's reason code.
      return new Map();
    }
  }
}

function hasPosixPs(platform: string): boolean {
  return platform === 'linux' || platform === 'darwin';
}

/** Default runner: `cross-spawn`, argument list, never a shell. */
function runCommand(
  command: string,
  args: readonly string[],
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = crossSpawn(command, [...args], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    let stdout = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.on('error', reject);
    child.on('close', () => resolve(stdout));
  });
}

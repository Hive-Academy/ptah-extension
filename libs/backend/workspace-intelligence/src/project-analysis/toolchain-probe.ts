/**
 * Toolchain probe — "is this stack's compiler actually on this machine?".
 *
 * The New Project flow needs this before it scaffolds: telling a user their
 * .NET solution failed to build is a much worse experience than telling them
 * up front that `dotnet` is not installed and where to get it.
 *
 * **Why `cross-spawn` and not a platform-core port.** There is no process/exec
 * port in `platform-core` — it exposes `ICommandRegistry` (VS Code command
 * registration) and a pty host, neither of which is a one-shot subprocess. The
 * precedent this follows is `probeCliVersion` in `cli-agent-runtime`, which
 * cannot be imported here without inverting the dependency graph. `cross-spawn`
 * rather than bare `node:child_process` because Node 18.20+/Electron 30+ refuse
 * `execFile` on Windows `.cmd`/`.bat` wrappers (CVE-2024-27980), and `python`
 * on Windows is frequently exactly such a shim.
 *
 * If a process port is ever added to `platform-core`, this module is the one
 * place that has to change.
 */

import crossSpawn from 'cross-spawn';
import type {
  StackProfile,
  ToolchainProbeResult,
} from '@ptah-extension/shared';

/** Probes are one-shot version queries; a slow one is a broken one. */
const DEFAULT_PROBE_TIMEOUT_MS = 5000;

export interface ToolchainProbeOptions {
  /** Milliseconds before the probe is killed and reported not-installed. */
  readonly timeoutMs?: number;
}

/**
 * Run a profile's `toolchain.probe` and report what is installed.
 *
 * **Never throws and never rejects.** A missing toolchain is the expected case,
 * not an exceptional one — it is the whole reason to call this — so it comes
 * back as `installed: false` with the profile's install hint attached, ready to
 * show the user.
 */
export async function probeStackToolchain(
  profile: StackProfile,
  options: ToolchainProbeOptions = {},
): Promise<ToolchainProbeResult> {
  const command = profile.toolchain.probe;
  const [binary, ...args] = command.split(/\s+/).filter(Boolean);

  const notInstalled: ToolchainProbeResult = {
    profileId: profile.id,
    command,
    installed: false,
    satisfiesMin: false,
    minVersion: profile.toolchain.minVersion,
    installHint: profile.toolchain.installHint,
  };

  if (!binary) {
    return notInstalled;
  }

  const output = await runProbe(
    binary,
    args,
    options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
  );
  if (!output.ok) {
    return notInstalled;
  }

  const version = parseProbeVersion(output.text);

  return {
    profileId: profile.id,
    command,
    installed: true,
    version,
    // An installed toolchain whose version we cannot read must not pass the
    // gate: silently scaffolding against an unknown SDK is worse than asking
    // the user to confirm what they have.
    satisfiesMin:
      version !== undefined &&
      compareVersions(version, profile.toolchain.minVersion) >= 0,
    minVersion: profile.toolchain.minVersion,
    installHint: profile.toolchain.installHint,
  };
}

/**
 * Spawn the probe and collect its output.
 *
 * `ok` means the binary was found AND exited zero. stdout and stderr are both
 * collected because `python --version` wrote to stderr until 3.4 and some
 * wrappers still do.
 */
function runProbe(
  binary: string,
  args: string[],
  timeoutMs: number,
): Promise<{ ok: boolean; text: string }> {
  return new Promise((resolve) => {
    let text = '';
    let settled = false;

    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok, text });
    };

    let child: ReturnType<typeof crossSpawn>;
    try {
      child = crossSpawn(binary, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
      });
    } catch {
      // cross-spawn can throw synchronously on a malformed binary name.
      resolve({ ok: false, text: '' });
      return;
    }

    const timer = setTimeout(() => {
      child.kill();
      finish(false);
    }, timeoutMs);
    timer.unref?.();

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      text += chunk;
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      text += chunk;
    });
    child.on('error', () => finish(false));
    child.on('close', (code) => finish(code === 0));
  });
}

/**
 * Pull a version out of probe output.
 *
 * Handles the three shapes the registry's probes actually produce: `8.0.404`
 * (dotnet), `v22.11.0` (node) and `Python 3.12.1`. Returns `undefined` rather
 * than guessing when there is no dotted number to find.
 */
export function parseProbeVersion(output: string): string | undefined {
  return /(\d+\.\d+(?:\.\d+)?)/.exec(output)?.[1];
}

/**
 * Compare two dotted version strings numerically.
 *
 * Returns a negative number, zero, or a positive number in the usual
 * comparator sense. Missing components count as 0, so `8.0` equals `8.0.0`.
 * Prerelease suffixes are truncated at the first `-`: `9.0.100-preview.1` is
 * treated as `9.0.100`, which is the answer a minimum-version gate wants — a
 * preview SDK does satisfy "8.0 or newer".
 *
 * Not semver-complete on purpose. It compares SDK version numbers, which is the
 * only thing that reaches it, and a full semver dependency for that would be
 * three orders of magnitude more code than the question deserves.
 */
export function compareVersions(left: string, right: string): number {
  const parse = (value: string): number[] =>
    value
      .split('-')[0]
      .split('.')
      .map((part) => Number.parseInt(part, 10))
      .map((part) => (Number.isNaN(part) ? 0 : part));

  const a = parse(left);
  const b = parse(right);

  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

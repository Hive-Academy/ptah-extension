/**
 * The peer session list (TASK_2026_402, Task 10.2).
 *
 * Turns the Claude CLI's own session registry into rows a user can choose
 * from, each stating a name, a workspace and whether it can be reached.
 *
 * ## The cross-workspace decision — INCLUDE, and here is why
 *
 * Requirement 10 criterion 5 asks for this to be an explicit, documented
 * choice rather than an accident. The choice is: **every workspace's sessions
 * are listed**, each row flagged with `inCurrentWorkspace`, and the response
 * carries `crossWorkspacePolicy: 'include-all-workspaces'` so the policy
 * travels with the data instead of living only in this comment.
 *
 * Three reasons, in order of weight:
 *
 *  1. **Filtering to one workspace would delete the main use case.** Ptah's
 *     own orchestration runs sessions in git worktrees, and a worktree has a
 *     different `cwd` by construction. Live records read on 2026-09-12 show
 *     exactly that: `D:\projects\ptah-extension` beside
 *     `D:\projects\ptah-extension\.claude-worktrees\skills-tab-...`. Those are
 *     the sessions a user most wants to address, and a same-cwd filter hides
 *     every one of them.
 *  2. **Silent omission is the failure mode criterion 3 names.** A caller can
 *     filter an included row; it cannot recover an excluded one. Inclusion
 *     plus a flag is the reversible direction.
 *  3. **Excluding buys no security.** Every row is already gated to this
 *     machine and this user by `pidDomain`, and the CLI's own peer channel is
 *     user-scoped, not workspace-scoped — a same-user process can reach these
 *     sockets whether or not Ptah lists them. A workspace filter would remove
 *     capability without removing reach.
 *
 * A caller that wants a shorter list should sort `inCurrentWorkspace` first,
 * not drop the rest.
 *
 * ## Liveness
 *
 * Never a bare pid check. See `process-start-time.probe.ts` for the measured
 * fingerprint encoding and the reason it matters on Windows. A row whose
 * liveness cannot be ESTABLISHED is `unreachable` with
 * `liveness-unverified` — shown, and not offered as if it works.
 */

import * as os from 'node:os';
import * as path from 'node:path';
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import type {
  PeerSessionListResult,
  PeerSessionNameSource,
  PeerSessionRow,
  PeerSessionUnreachableReason,
} from '@ptah-extension/shared';
import {
  currentPidDomain,
  recordStartFingerprint,
  scanPeerSessionRegistry,
  type PeerSessionRecord,
  type PeerSessionRegistryScan,
} from './peer-session-registry.reader';
import {
  ProcessStartTimeProbe,
  decodeStartFingerprint,
  type ProcessStartTimes,
} from './process-start-time.probe';

export interface PeerSessionListOptions {
  /** Host's current workspace root, used only to set `inCurrentWorkspace`. */
  readonly currentWorkspace?: string;
  /** The caller's own session id. Its row is dropped, never self-addressed. */
  readonly excludeSessionId?: string;
}

@injectable()
export class PeerSessionDirectory {
  private readonly probe: ProcessStartTimeProbe;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    probe?: ProcessStartTimeProbe,
  ) {
    this.probe = probe ?? new ProcessStartTimeProbe();
  }

  async list(
    options: PeerSessionListOptions = {},
  ): Promise<PeerSessionListResult> {
    const currentWorkspace = options.currentWorkspace?.trim() || null;

    let scan: PeerSessionRegistryScan;
    try {
      scan = await scanPeerSessionRegistry();
    } catch (error: unknown) {
      // The registry directory exists but could not be listed. That is a
      // genuine failure, not "no sessions", so it is raised rather than
      // returned as an empty list a caller would read as "nothing running".
      this.logger.warn('[PeerSessionDirectory] registry scan failed', {
        reason: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    const startTimes = await this.probe.probe(
      scan.records.map((record) => record.pid),
    );

    const rows: PeerSessionRow[] = [];

    for (const record of scan.records) {
      if (
        options.excludeSessionId &&
        record.sessionId === options.excludeSessionId
      ) {
        continue;
      }
      rows.push(
        this.toRow(record, currentWorkspace, {
          startTimes,
          toleranceMs: this.probe.toleranceMs,
        }),
      );
    }

    for (const file of scan.unreadable) {
      this.logger.warn('[PeerSessionDirectory] unreadable registry record', {
        file: file.file,
        reason: file.reason,
      });
      rows.push(unreadableRow(file.file));
    }

    this.logger.debug('[PeerSessionDirectory] listed peer sessions', {
      total: rows.length,
      reachable: rows.filter((row) => row.reachability === 'reachable').length,
      livenessVerifiable: this.probe.supported,
    });

    return {
      sessions: rows,
      currentWorkspace,
      crossWorkspacePolicy: 'include-all-workspaces',
      livenessVerifiable: this.probe.supported,
    };
  }

  private toRow(
    record: PeerSessionRecord,
    currentWorkspace: string | null,
    context: ReachabilityContext,
  ): PeerSessionRow {
    const unreachableReason = resolveUnreachableReason(record, context);
    const { name, nameSource } = resolveName(record);

    return {
      sessionId: record.sessionId,
      name,
      nameSource,
      workspace: record.cwd,
      workspaceLabel: path.basename(record.cwd) || record.cwd,
      inCurrentWorkspace: samePath(record.cwd, currentWorkspace),
      reachability: unreachableReason ? 'unreachable' : 'reachable',
      ...(unreachableReason ? { unreachableReason } : {}),
      pid: record.pid,
      ...(record.version ? { cliVersion: record.version } : {}),
      ...(record.startedAt !== undefined ? { startedAt: record.startedAt } : {}),
    };
  }
}

/**
 * The single reachability decision, in the order that makes each `undefined`
 * mean something different from the next. Returns `undefined` when — and only
 * when — every check passed.
 */
export interface ReachabilityContext {
  readonly startTimes: ProcessStartTimes;
  readonly toleranceMs: number;
  readonly now?: number;
  /** This host's `pidDomain`. Injected so the rule is testable off-Windows. */
  readonly hostPidDomain?: string;
}

export function resolveUnreachableReason(
  record: PeerSessionRecord,
  context: ReachabilityContext,
): PeerSessionUnreachableReason | undefined {
  const {
    startTimes,
    toleranceMs,
    now = Date.now(),
    hostPidDomain = currentPidDomain(),
  } = context;

  // No inbox, nothing to address. Pre-peer-channel CLI builds land here.
  if (!record.messagingSocketPath) {
    return 'no-messaging-channel';
  }

  // A pid only means something inside its own machine and platform.
  if (!record.pidDomain) {
    return 'liveness-unverified';
  }
  if (record.pidDomain.toLowerCase() !== hostPidDomain) {
    return 'other-host';
  }

  const fingerprint = recordStartFingerprint(record);
  if (!fingerprint) {
    return 'liveness-unverified';
  }
  const recordedStart = decodeStartFingerprint(fingerprint, now);
  if (recordedStart === null) {
    return 'liveness-unverified';
  }

  // Absent from the map means the probe established nothing at all — which is
  // NOT the same as the probe reporting the pid is gone (`null`).
  if (!startTimes.has(record.pid)) {
    return 'liveness-unverified';
  }
  const observedStart = startTimes.get(record.pid);
  if (observedStart === null || observedStart === undefined) {
    return 'process-not-running';
  }

  // The pid is alive but belongs to a different process than the one that
  // registered. This is the pid-recycle case.
  if (Math.abs(observedStart - recordedStart) > toleranceMs) {
    return 'process-identity-mismatch';
  }

  return undefined;
}

/**
 * The display name, and how much it is worth.
 *
 * A session started before Batch 9, or one whose chosen name never reached the
 * registry, arrives here with the CLI's derived label — or with nothing. Both
 * are handled; neither is presented as a name the user picked.
 */
export function resolveName(record: PeerSessionRecord): {
  readonly name: string;
  readonly nameSource: PeerSessionNameSource;
} {
  const recorded = record.name?.trim();
  if (!recorded) {
    return {
      name: `${path.basename(record.cwd) || 'session'} (pid ${record.pid})`,
      nameSource: 'unknown',
    };
  }
  if (record.nameSource === 'user') {
    return { name: recorded, nameSource: 'user' };
  }
  if (record.nameSource === 'derived') {
    return { name: recorded, nameSource: 'derived' };
  }
  return { name: recorded, nameSource: 'unknown' };
}

/**
 * A registry file that exists but does not parse still gets a row. The user
 * learns something is there that Ptah cannot read, instead of the file
 * vanishing from the list — and because the row is unreachable,
 * `peerSession:send` refuses it before anything is composed.
 */
export function unreadableRow(file: string): PeerSessionRow {
  const base = path.basename(file, '.json');
  return {
    sessionId: `unreadable:${base}`,
    name: `unreadable session record (${path.basename(file)})`,
    nameSource: 'unknown',
    workspace: '',
    workspaceLabel: '',
    inCurrentWorkspace: false,
    reachability: 'unreachable',
    unreachableReason: 'record-unreadable',
    pid: /^\d+$/.test(base) ? Number(base) : 0,
  };
}

function samePath(candidate: string, reference: string | null): boolean {
  if (!reference) {
    return false;
  }
  return normalize(candidate) === normalize(reference);
}

function normalize(value: string): string {
  const resolved = path.resolve(value).replace(/[\\/]+$/, '');
  return os.platform() === 'win32' ? resolved.toLowerCase() : resolved;
}

/**
 * Remote machines renderer contract (`machines:*`, TASK_2026_858 W11).
 *
 * The Electron renderer talks to remote Ptah workers only through Electron
 * main: it calls the `machines:*` RPC methods below over IPC, and main pushes
 * two message types back (`machines:event`, `machines:state`). Main owns the
 * SSH transport, the worker connection and the pairing tokens; nothing in
 * this module carries a token or an admin key.
 *
 * This module must not import `@ptah-extension/worker-protocol`. The shapes
 * that cross into the renderer (session summaries, readiness rows, attach
 * results) are restated here so `libs/shared` stays dependency-free; Electron
 * main maps worker results onto them.
 *
 * Params are validated at the IPC boundary with the zod schemas below (strict,
 * so an unknown key is rejected). Results are produced by Electron main and
 * are plain interfaces.
 *
 * `MachinesRpcMethodRegistry` is merged into `RpcMethodRegistry` through
 * `extends` (`rpc.types.ts`), and every name here is an `RPC_METHOD_NAMES`
 * entry. `assertManifestInvariants` (rpc-handlers) requires each to have an
 * owner: the host-owned `host.remoteMachines` manifest entry, gated on the
 * `remoteMachines` capability.
 */

import { z } from 'zod';
import type { FlatStreamEventUnion } from '../execution';

// ---------------------------------------------------------------------------
// Limits (kept equal to the worker's own bounds)
// ---------------------------------------------------------------------------

/** Max length of a machine, workspace, session or request ID. */
export const MACHINE_ID_MAX_LENGTH = 256;

/** Max length of a prompt sent to a remote session. */
export const MACHINE_PROMPT_MAX_LENGTH = 200_000;

/** Max length of typed pairing-code input (separators and spaces included). */
export const MACHINE_PAIRING_CODE_INPUT_MAX_LENGTH = 32;

/**
 * An SSH `Host` alias the app may pass to `ssh`. The first character is
 * alphanumeric so an alias can never be read as an option (`-oProxyCommand=…`).
 */
export const MACHINE_SSH_ALIAS_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

// ---------------------------------------------------------------------------
// Method names
// ---------------------------------------------------------------------------

/** Every `machines:*` RPC method, in registry order. */
export const MACHINES_RPC_METHOD_NAMES = [
  'machines:list',
  'machines:sshAliases',
  'machines:add',
  'machines:pair',
  'machines:pairViaSsh',
  'machines:remove',
  'machines:retry',
  'machines:readiness',
  'machines:workspaces',
  'machines:sessions',
  'machines:session.attach',
  'machines:session.detach',
  'machines:session.replay',
  'machines:session.start',
  'machines:session.continue',
  'machines:session.stop',
  'machines:permission.respond',
] as const satisfies readonly (keyof MachinesRpcMethodRegistry)[];

export type MachinesRpcMethodName = (typeof MACHINES_RPC_METHOD_NAMES)[number];

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

const IdSchema = z.string().min(1).max(MACHINE_ID_MAX_LENGTH);
const PromptSchema = z.string().min(1).max(MACHINE_PROMPT_MAX_LENGTH);

/**
 * Connection state of one machine, as Electron main reports it.
 *
 * - `connected` — authenticated, protocol agreed.
 * - `offline` — not reachable now; main retries on its backoff schedule.
 * - `reconnecting` — a connection attempt is in flight.
 * - `version-mismatch` — reachable, but no common protocol version.
 * - `unpaired` — registered by alias, no token yet.
 */
export const MACHINE_CONNECTION_STATES = [
  'connected',
  'offline',
  'reconnecting',
  'version-mismatch',
  'unpaired',
] as const;

export type MachineConnectionState = (typeof MACHINE_CONNECTION_STATES)[number];

/** Inclusive range of worker protocol versions one side speaks. */
export interface MachineProtocolRange {
  readonly min: number;
  readonly max: number;
}

/** The Ptah build and protocol range of one side of a connection. */
export interface MachineVersionInfo {
  readonly ptahVersion: string;
  readonly protocol: MachineProtocolRange;
}

/** Both sides' versions, shown on a version mismatch. */
export interface MachineVersions {
  readonly local: MachineVersionInfo;
  /** Absent until the worker has answered `hello` once. */
  readonly remote?: MachineVersionInfo;
}

/** One registered machine. Never carries its token. */
export interface MachineSummary {
  readonly machineId: string;
  /** The `~/.ssh/config` `Host` alias the machine was added by. */
  readonly alias: string;
  /** The worker's own display name once known; otherwise the alias. */
  readonly displayName: string;
  readonly state: MachineConnectionState;
  /** Epoch ms of the next reconnect attempt, while `offline`. */
  readonly nextRetryAt?: number;
  readonly versions?: MachineVersions;
  /** Epoch ms of the last frame received from the worker. */
  readonly lastSeenAt?: number;
}

/** Which process drives a remote session now. */
export interface MachineSessionDriver {
  readonly kind: 'desktop' | 'worker' | 'cli';
  readonly label: string;
}

export const REMOTE_MACHINE_SESSION_STATES = [
  'running',
  'idle',
  'interrupted',
] as const;

export type RemoteMachineSessionState =
  (typeof REMOTE_MACHINE_SESSION_STATES)[number];

/** One session on a remote workspace. */
export interface RemoteMachineSessionSummary {
  readonly sessionId: string;
  readonly title: string;
  readonly state: RemoteMachineSessionState;
  readonly driver?: MachineSessionDriver;
  /** Epoch ms. */
  readonly updatedAt: number;
  readonly provider: string;
  /** Whether the worker keeps an event log for it (live attach possible). */
  readonly logged: boolean;
}

/** One workspace a machine's grant allows. */
export interface RemoteMachineWorkspace {
  readonly workspaceId: string;
  readonly name: string;
  readonly path: string;
}

/** One readiness row (worker doctor, or Electron main's local checks). */
export interface MachineReadinessCheck {
  readonly id: string;
  readonly label: string;
  readonly status: 'pass' | 'warn' | 'fail';
  readonly detail?: string;
  /** Fix text shown under a failing or warning row. */
  readonly fix?: string;
}

export interface MachineReadinessReport {
  readonly ready: boolean;
  readonly checks: readonly MachineReadinessCheck[];
}

// ---------------------------------------------------------------------------
// Params schemas
// ---------------------------------------------------------------------------

const EmptyParamsSchema = z.strictObject({});
const MachineParamsSchema = z.strictObject({ machineId: IdSchema });
const MachineSessionParamsSchema = z.strictObject({
  machineId: IdSchema,
  sessionId: IdSchema,
});

export const MachinesListParamsSchema = EmptyParamsSchema;
export const MachinesSshAliasesParamsSchema = EmptyParamsSchema;

export const MachinesAddParamsSchema = z.strictObject({
  alias: z.string().regex(MACHINE_SSH_ALIAS_PATTERN),
});

export const MachinesPairParamsSchema = z.strictObject({
  machineId: IdSchema,
  // No format check: a malformed code takes the same path as a wrong one.
  code: z.string().min(1).max(MACHINE_PAIRING_CODE_INPUT_MAX_LENGTH),
});

export const MachinesPairViaSshParamsSchema = MachineParamsSchema;
export const MachinesRemoveParamsSchema = MachineParamsSchema;
export const MachinesRetryParamsSchema = MachineParamsSchema;
export const MachinesReadinessParamsSchema = MachineParamsSchema;
export const MachinesWorkspacesParamsSchema = MachineParamsSchema;

export const MachinesSessionsParamsSchema = z.strictObject({
  machineId: IdSchema,
  workspaceId: IdSchema,
});

export const MachinesSessionAttachParamsSchema = MachineSessionParamsSchema;
export const MachinesSessionDetachParamsSchema = MachineSessionParamsSchema;

export const MachinesSessionReplayParamsSchema = z.strictObject({
  machineId: IdSchema,
  sessionId: IdSchema,
  /** Last sequence number the renderer applied; replay starts after it. */
  afterSeq: z.number().int().min(0),
});

export const MachinesSessionStartParamsSchema = z.strictObject({
  machineId: IdSchema,
  workspaceId: IdSchema,
  prompt: PromptSchema,
  name: z.string().min(1).max(256).optional(),
});

export const MachinesSessionContinueParamsSchema = z.strictObject({
  machineId: IdSchema,
  sessionId: IdSchema,
  prompt: PromptSchema,
});

export const MachinesSessionStopParamsSchema = MachineSessionParamsSchema;

export const MachinesPermissionRespondParamsSchema = z.strictObject({
  machineId: IdSchema,
  sessionId: IdSchema,
  requestId: IdSchema,
  // Phase 1 offers allow and deny only (design D4).
  decision: z.enum(['allow', 'deny']),
  reason: z.string().max(2048).optional(),
});

export type MachinesListParams = z.infer<typeof MachinesListParamsSchema>;
export type MachinesSshAliasesParams = z.infer<
  typeof MachinesSshAliasesParamsSchema
>;
export type MachinesAddParams = z.infer<typeof MachinesAddParamsSchema>;
export type MachinesPairParams = z.infer<typeof MachinesPairParamsSchema>;
export type MachinesPairViaSshParams = z.infer<
  typeof MachinesPairViaSshParamsSchema
>;
export type MachinesRemoveParams = z.infer<typeof MachinesRemoveParamsSchema>;
export type MachinesRetryParams = z.infer<typeof MachinesRetryParamsSchema>;
export type MachinesReadinessParams = z.infer<
  typeof MachinesReadinessParamsSchema
>;
export type MachinesWorkspacesParams = z.infer<
  typeof MachinesWorkspacesParamsSchema
>;
export type MachinesSessionsParams = z.infer<
  typeof MachinesSessionsParamsSchema
>;
export type MachinesSessionAttachParams = z.infer<
  typeof MachinesSessionAttachParamsSchema
>;
export type MachinesSessionDetachParams = z.infer<
  typeof MachinesSessionDetachParamsSchema
>;
export type MachinesSessionReplayParams = z.infer<
  typeof MachinesSessionReplayParamsSchema
>;
export type MachinesSessionStartParams = z.infer<
  typeof MachinesSessionStartParamsSchema
>;
export type MachinesSessionContinueParams = z.infer<
  typeof MachinesSessionContinueParamsSchema
>;
export type MachinesSessionStopParams = z.infer<
  typeof MachinesSessionStopParamsSchema
>;
export type MachinesPermissionRespondParams = z.infer<
  typeof MachinesPermissionRespondParamsSchema
>;

/** Params schema per method, for the Electron handler's first-line parse. */
export const MACHINES_RPC_PARAMS_SCHEMAS = {
  'machines:list': MachinesListParamsSchema,
  'machines:sshAliases': MachinesSshAliasesParamsSchema,
  'machines:add': MachinesAddParamsSchema,
  'machines:pair': MachinesPairParamsSchema,
  'machines:pairViaSsh': MachinesPairViaSshParamsSchema,
  'machines:remove': MachinesRemoveParamsSchema,
  'machines:retry': MachinesRetryParamsSchema,
  'machines:readiness': MachinesReadinessParamsSchema,
  'machines:workspaces': MachinesWorkspacesParamsSchema,
  'machines:sessions': MachinesSessionsParamsSchema,
  'machines:session.attach': MachinesSessionAttachParamsSchema,
  'machines:session.detach': MachinesSessionDetachParamsSchema,
  'machines:session.replay': MachinesSessionReplayParamsSchema,
  'machines:session.start': MachinesSessionStartParamsSchema,
  'machines:session.continue': MachinesSessionContinueParamsSchema,
  'machines:session.stop': MachinesSessionStopParamsSchema,
  'machines:permission.respond': MachinesPermissionRespondParamsSchema,
} as const satisfies Record<MachinesRpcMethodName, z.ZodType>;

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export interface MachinesListResult {
  readonly machines: readonly MachineSummary[];
}

export interface MachinesSshAliasesResult {
  /** `Host` aliases from `~/.ssh/config` that match the alias pattern. */
  readonly aliases: readonly string[];
}

/** `machines:add`, `machines:pair`, `machines:pairViaSsh`, `machines:retry`. */
export interface MachineResult {
  readonly machine: MachineSummary;
}

export interface MachinesRemoveResult {
  readonly removed: true;
  /** Whether the worker confirmed `token.revokeSelf` before the local delete. */
  readonly revokedOnWorker: boolean;
}

export interface MachinesReadinessResult {
  readonly machineId: string;
  /** The worker's doctor report; `null` while the machine is not connected. */
  readonly remote: MachineReadinessReport | null;
  /** Electron main's own checks (driver-lock self-test). */
  readonly local: MachineReadinessReport;
}

export interface MachinesWorkspacesResult {
  readonly workspaces: readonly RemoteMachineWorkspace[];
}

export interface MachinesSessionsResult {
  readonly sessions: readonly RemoteMachineSessionSummary[];
}

/**
 * Attach (or replay) outcome.
 *
 * - `log` — the session has an event log. Events from `fromSeq` up to
 *   `headSeq` and onward arrive as `machines:event` pushes.
 * - `snapshot` — no log (the session is not logged, or another process
 *   drives it): a one-off saved transcript, never live.
 */
export type MachinesSessionAttachResult =
  | {
      readonly mode: 'log';
      readonly epoch: string;
      readonly fromSeq: number;
      readonly headSeq: number;
    }
  | {
      readonly mode: 'snapshot';
      readonly events: readonly FlatStreamEventUnion[];
      readonly live: false;
      /** Holder label when another process drives the session now. */
      readonly drivenBy?: string;
    };

export interface MachinesSessionDetachResult {
  readonly detached: true;
}

export interface MachinesSessionStartResult {
  readonly sessionId: string;
  readonly turnId: string;
}

export interface MachinesSessionContinueResult {
  readonly turnId: string;
  /** Set when the worker's backend enqueued the prompt behind a running turn. */
  readonly queued?: true;
}

export interface MachinesSessionStopResult {
  readonly stopped: boolean;
}

export interface MachinesPermissionRespondResult {
  readonly applied: true;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export interface MachinesRpcMethodRegistry {
  'machines:list': { params: MachinesListParams; result: MachinesListResult };
  'machines:sshAliases': {
    params: MachinesSshAliasesParams;
    result: MachinesSshAliasesResult;
  };
  'machines:add': { params: MachinesAddParams; result: MachineResult };
  'machines:pair': { params: MachinesPairParams; result: MachineResult };
  'machines:pairViaSsh': {
    params: MachinesPairViaSshParams;
    result: MachineResult;
  };
  'machines:remove': {
    params: MachinesRemoveParams;
    result: MachinesRemoveResult;
  };
  'machines:retry': { params: MachinesRetryParams; result: MachineResult };
  'machines:readiness': {
    params: MachinesReadinessParams;
    result: MachinesReadinessResult;
  };
  'machines:workspaces': {
    params: MachinesWorkspacesParams;
    result: MachinesWorkspacesResult;
  };
  'machines:sessions': {
    params: MachinesSessionsParams;
    result: MachinesSessionsResult;
  };
  'machines:session.attach': {
    params: MachinesSessionAttachParams;
    result: MachinesSessionAttachResult;
  };
  'machines:session.detach': {
    params: MachinesSessionDetachParams;
    result: MachinesSessionDetachResult;
  };
  'machines:session.replay': {
    params: MachinesSessionReplayParams;
    result: MachinesSessionAttachResult;
  };
  'machines:session.start': {
    params: MachinesSessionStartParams;
    result: MachinesSessionStartResult;
  };
  'machines:session.continue': {
    params: MachinesSessionContinueParams;
    result: MachinesSessionContinueResult;
  };
  'machines:session.stop': {
    params: MachinesSessionStopParams;
    result: MachinesSessionStopResult;
  };
  'machines:permission.respond': {
    params: MachinesPermissionRespondParams;
    result: MachinesPermissionRespondResult;
  };
}

/**
 * Compile-time proof that the name tuple and the registry list the same
 * methods. Either side drifting turns this into a type error.
 */
type _MachinesNamesNotInRegistry = Exclude<
  MachinesRpcMethodName,
  keyof MachinesRpcMethodRegistry
>;
type _MachinesRegistryNotInNames = Exclude<
  keyof MachinesRpcMethodRegistry,
  MachinesRpcMethodName
>;
/** Fails to compile, in this file, unless its argument is `never`. */
type _RequireNever<T extends never> = T;
export type MachinesRpcRegistryInSync = [
  _RequireNever<_MachinesNamesNotInRegistry | _MachinesRegistryNotInNames>,
] extends [never]
  ? true
  : never;

// ---------------------------------------------------------------------------
// Push payloads
// ---------------------------------------------------------------------------

/**
 * Payload of `machines:event`: one logged session event, forwarded unchanged
 * from the worker. `type` is a worker session event type (a captured push
 * type such as `chat:chunk`, or a `worker:*` record); `payload` is that
 * type's body. The renderer's session reducer validates both.
 */
export interface MachinesEventPayload {
  readonly machineId: string;
  readonly sessionId: string;
  readonly epoch: string;
  readonly seq: number;
  readonly type: string;
  readonly payload: unknown;
}

/** Payload of `machines:state`: one machine's connection state changed. */
export interface MachinesStatePayload {
  readonly machineId: string;
  readonly state: MachineConnectionState;
  readonly nextRetryAt?: number;
  readonly versions?: MachineVersions;
  readonly lastSeenAt?: number;
}

/**
 * `ISessionSpawner` (TASK_2026_584): child chat sessions a parent session
 * starts with `ptah_session_start`, each in its own git worktree and its own
 * tab.
 *
 * The spawner guards, provisions the worktree, records the parent → child
 * link and the child's unattended permission policy, then asks the host port
 * to start an ordinary chat session. It never owns the stream: it observes
 * the child through host-wide SDK fan-outs subscribed ONCE here (turn
 * ended/failed, SDK id resolved, session end, permission prompt lifecycle)
 * and released in `dispose()`. Nothing polls.
 *
 * Children keep running when their parent ends (user decision, Revision 1):
 * only `stop` (or the Stop button in the child's own tab) ends one. While the
 * parent is not live, the latest undelivered completion per child is held
 * and handed to the parent's next `ptah_session_*` call.
 *
 * Timers: one runtime timer per live child (bounded by the cap) and at most
 * one 30 s grace timer per live child whose session ended; all cleared when
 * the child ends and in `dispose()`.
 */
import { inject, injectable, type DependencyContainer } from 'tsyringe';
import { isAbsolute, resolve } from 'path';
import {
  SDK_TOKENS,
  SessionAdmissionRefusedError,
  type PermissionPromptLifecycleEvent,
  type SdkAdapterEvents,
  type SdkAdapterTurnEndedEvent,
  type SdkAdapterTurnFailedEvent,
  type SdkPermissionHandler,
  type SessionEndCallbackRegistry,
  type SessionEndPayload,
  type SessionIdResolvedCallbackRegistry,
  type SessionIdResolvedPayload,
  type SessionLifecycleManager,
  type SessionTurnStateRegistry,
  type UnattendedSessionPolicyRegistry,
} from '@ptah-extension/agent-sdk';
import {
  MEMORY_CONTRACT_TOKENS,
  type ITranscriptReader,
} from '@ptah-extension/memory-contracts';
import {
  PLATFORM_TOKENS,
  isPathWithinRoots,
  type IMcpServerStatus,
  type IMcpSubagentRootRegistrar,
  type IOutputChannel,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import {
  SessionId,
  normalizeWorkspaceRoot,
  type AgentSessionOpenedPayload,
  type AIMessageOrigin,
  type IAgentAdapter,
  type SessionTurnPhase,
} from '@ptah-extension/shared';
import { TOKENS, resolveWorktreePath } from '@ptah-extension/vscode-core';
import { CLI_AGENT_RUNTIME_TOKENS } from '../di/tokens';
import type { AgentProcessManager } from '../cli-agents/agent-process-manager.service';
import { AgentSpawnEnvironment } from '../cli-agents/agent-spawn-environment.service';
import { LaneCompletionNotifier } from '../cli-agents/lane-completion-notifier.service';
import type {
  ChildChatSessionStartOutcome,
  IChildChatSessionHost,
} from './child-chat-session-host.port';
import {
  ChildWorktreeProvisioner,
  type ChildWorktree,
} from './child-worktree.provisioner';
import {
  SessionChildRegistry,
  type SessionChildRecord,
  type SessionChildReservation,
} from './session-child.registry';
import {
  composeSessionChildPrompt,
  renderSessionChildContract,
} from './session-child-contract';
import {
  readSessionChildSettings,
  type SessionChildSettings,
} from './session-child-settings';
import type {
  ISessionSpawner,
  SessionChildCompletionDelivery,
  SessionChildCompletionEnvelope,
  SessionChildLookupRefusal,
  SessionChildQuery,
  SessionChildReadResult,
  SessionChildRollbackStep,
  SessionChildSendRequest,
  SessionChildSendResult,
  SessionChildSettle,
  SessionChildSnapshot,
  SessionChildStartRequest,
  SessionChildStartResult,
  SessionChildStatus,
  SessionSpawnRefusalCode,
} from './session-spawner.port';

const LOG_PREFIX = '[SessionSpawner]';

/** How long an ended child session may take to re-register before it is ended. */
export const SESSION_CHILD_GRACE_MS = 30_000;
export const SESSION_READ_DEFAULT_TAIL_KIB = 32;
export const SESSION_READ_MAX_TAIL_KIB = 256;
/** JSONL bytes read per KiB of transcript returned: the JSONL is far more verbose. */
const TRANSCRIPT_BYTES_PER_OUTPUT_KIB = 4 * 1024;

/** Per-child state that is not part of the serialisable record. */
interface ChildRuntime {
  readonly worktree: ChildWorktree;
  releasePolicy?: () => void;
  /** The exact string given to `retainRoot`; `releaseRoot` must get the same one. */
  mcpRoot?: string;
  runtimeTimer?: ReturnType<typeof setTimeout>;
  graceTimer?: ReturnType<typeof setTimeout>;
  /** Timestamp of the last settled turn event, for dedupe. */
  lastSettleTimestamp?: number;
  /** Set while the spawner itself ends the child; events are then ignored. */
  stopping: boolean;
  pendingRequestId?: string;
}

type StartRefusal = Extract<SessionChildStartResult, { ok: false }>;

type OwnedLookup =
  | {
      readonly ok: true;
      readonly child: SessionChildRecord;
      readonly caller: SessionId;
    }
  | { readonly ok: false; readonly refusal: SessionChildLookupRefusal };

interface StartGuardPass {
  readonly ok: true;
  readonly caller: SessionId;
  readonly adapter: IAgentAdapter;
  readonly host: IChildChatSessionHost;
  readonly settings: SessionChildSettings;
  readonly reservation: SessionChildReservation;
}

@injectable()
export class SessionSpawnerService implements ISessionSpawner {
  private readonly runtimes = new Map<string, ChildRuntime>();
  private readonly disposers: Array<() => void> = [];
  private disposed = false;

  constructor(
    @inject(SessionChildRegistry)
    private readonly registry: SessionChildRegistry,
    @inject(ChildWorktreeProvisioner)
    private readonly provisioner: ChildWorktreeProvisioner,
    @inject(LaneCompletionNotifier)
    private readonly notifier: LaneCompletionNotifier,
    @inject(AgentSpawnEnvironment)
    private readonly environment: AgentSpawnEnvironment,
    @inject(TOKENS.AGENT_PROCESS_MANAGER)
    private readonly agents: AgentProcessManager,
    @inject(SDK_TOKENS.SDK_UNATTENDED_SESSION_POLICY_REGISTRY)
    private readonly policies: UnattendedSessionPolicyRegistry,
    @inject(SDK_TOKENS.SDK_ADAPTER_EVENTS)
    adapterEvents: SdkAdapterEvents,
    @inject(SDK_TOKENS.SDK_SESSION_ID_RESOLVED_CALLBACK_REGISTRY)
    idResolved: SessionIdResolvedCallbackRegistry,
    @inject(SDK_TOKENS.SDK_SESSION_END_CALLBACK_REGISTRY)
    sessionEnd: SessionEndCallbackRegistry,
    @inject(SDK_TOKENS.SDK_PERMISSION_HANDLER)
    permissions: SdkPermissionHandler,
    @inject(SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER)
    private readonly lifecycle: SessionLifecycleManager,
    @inject(SDK_TOKENS.SDK_SESSION_TURN_STATE_REGISTRY)
    private readonly turnState: SessionTurnStateRegistry,
    @inject(MEMORY_CONTRACT_TOKENS.TRANSCRIPT_READER)
    private readonly transcripts: ITranscriptReader,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(PLATFORM_TOKENS.OUTPUT_CHANNEL)
    private readonly output: IOutputChannel,
    /** Absent in a host without a chat runtime → `chat-runtime-unavailable`. */
    @inject(TOKENS.AGENT_ADAPTER, { isOptional: true })
    private readonly adapter: IAgentAdapter | null = null,
    /**
     * Where the chat host port (`CHILD_CHAT_SESSION_HOST`) is looked up, at
     * `start()` time and never here: `registerChatServices` registers it in a
     * later phase than this spawner, so a constructor injection would capture
     * `null` for the life of the process whenever anything resolves the
     * spawner first (B5 review, Task 6.6). Optional for the same reason as in
     * `PtahCliRegistry`: every host registers `DI_CONTAINER`. Absent, or no
     * host registered at `start()` → `chat-runtime-unavailable`.
     */
    @inject(PLATFORM_TOKENS.DI_CONTAINER, { isOptional: true })
    private readonly container: DependencyContainer | null = null,
    /** Absent or port-less (CLI host) → `mcp-unavailable`. */
    @inject(PLATFORM_TOKENS.MCP_SERVER_STATUS, { isOptional: true })
    private readonly mcpStatus: IMcpServerStatus | null = null,
    /** Absent → the child starts with `subagentPtahTools: 'unavailable'`. */
    @inject(PLATFORM_TOKENS.MCP_SUBAGENT_ROOT_REGISTRAR, { isOptional: true })
    private readonly rootRegistrar: IMcpSubagentRootRegistrar | null = null,
  ) {
    this.disposers.push(
      adapterEvents.onTurnEnded((event) => this.onTurnEnded(event)),
      adapterEvents.onTurnFailed((event) => this.onTurnFailed(event)),
      idResolved.register((payload) => this.onSessionIdResolved(payload)),
      sessionEnd.register((payload) => this.onSessionEnd(payload)),
      permissions.onPromptLifecycle((event) => this.onPromptLifecycle(event)),
    );
  }

  /* ------------------------------------------------------------------------
   * start
   * ---------------------------------------------------------------------- */

  async start(
    request: SessionChildStartRequest,
  ): Promise<SessionChildStartResult> {
    const guard = this.guardStart(request.callerSessionId);
    if (!guard.ok) return guard;
    // `add` consumes the reservation; releasing it afterwards is a no-op, so
    // every exit path can release unconditionally.
    try {
      return await this.provisionAndStart(request, guard);
    } finally {
      this.registry.release(guard.reservation);
    }
  }

  /** The synchronous guards, in order; the slot is reserved last. */
  private guardStart(
    callerSessionId: string | undefined,
  ): StartGuardPass | StartRefusal {
    if (this.disposed) {
      return this.refuseStart(
        'chat-runtime-unavailable',
        'the host is shutting down',
      );
    }
    const host = this.lookupHost();
    if (!host || !this.adapter) {
      return this.refuseStart(
        'chat-runtime-unavailable',
        'this host has no chat runtime to start a child session in',
      );
    }
    const caller = SessionId.safeParse(callerSessionId?.trim());
    if (!caller || !this.adapter.isSessionActive(caller)) {
      return this.refuseStart(
        'unattributed-caller',
        'ptah_session_start must be called from a live chat session; this ' +
          'caller has no live session id',
      );
    }
    const callerSdkId = this.sdkIdOf(caller);
    if (this.registry.isChild(caller) || this.registry.isChild(callerSdkId)) {
      return this.refuseStart(
        'depth-exceeded',
        'a child session cannot start child sessions (depth is limited to 1)',
      );
    }
    if (!this.mcpStatus || this.mcpStatus.getPort() === null) {
      return this.refuseStart(
        'mcp-unavailable',
        'the Ptah MCP server is not running in this host, so a child could ' +
          'not report back or be steered',
      );
    }
    const settings = readSessionChildSettings(this.workspace);
    const reservation = this.registry.reserveSlot(settings.maxConcurrent);
    if (!reservation) {
      const own = this.registry
        .childrenOf([caller, callerSdkId])
        .filter((child) => !child.terminalStatus)
        .map((child) => `${child.label} (${child.childSessionId})`);
      return this.refuseStart(
        'cap-reached',
        `${settings.maxConcurrent} child sessions are already live in this ` +
          'host (agentSessions.maxConcurrent). ' +
          (own.length > 0
            ? `Stop one of yours with ptah_session_stop: ${own.join(', ')}.`
            : 'None of them belongs to this session.'),
      );
    }
    return {
      ok: true,
      caller,
      adapter: this.adapter,
      host,
      settings,
      reservation,
    };
  }

  private async provisionAndStart(
    request: SessionChildStartRequest,
    guard: StartGuardPass,
  ): Promise<SessionChildStartResult> {
    const root = this.resolveRoot();
    if (typeof root !== 'string') return root;

    const branch = request.branch?.trim() ?? '';
    const task = request.task?.trim() ?? '';
    if (!task) return this.refuseStart('invalid-arguments', 'task is empty');
    if (!branch)
      return this.refuseStart('invalid-arguments', 'branch is empty');

    // The path the provisioner will create: the same deterministic function,
    // so task folder and deliverables are checked before any git work.
    const plannedPath = resolveWorktreePath(root, branch);
    const paths = resolveChildPaths(plannedPath, request);
    if (!paths.ok) return this.refuseStart('invalid-arguments', paths.detail);

    const provisioned = await this.provisioner.create(
      root,
      branch,
      request.baseRef,
    );
    if (!provisioned.ok) {
      this.log(`start refused (${provisioned.refusal}): ${provisioned.detail}`);
      return {
        ok: false,
        refusal: provisioned.refusal,
        detail: provisioned.detail,
        ...(provisioned.rollback ? { rollback: provisioned.rollback } : {}),
      };
    }
    // Stamped after `git worktree add` returned: every checked-out file is
    // older, so it never reads as this child's deliverable.
    const startedAt = new Date().toISOString();
    const { worktree } = provisioned;

    const childTabId = SessionId.create();
    const parentSdkSessionId = this.sdkIdOf(guard.caller);
    const label = request.label?.trim() || branch;
    const record: SessionChildRecord = {
      childSessionId: childTabId,
      parentSessionId: guard.caller,
      ...(parentSdkSessionId ? { parentSdkSessionId } : {}),
      label,
      ...(request.taskId ? { taskId: request.taskId } : {}),
      branch,
      baseRef: worktree.baseSha,
      workspaceRoot: root,
      worktreePath: worktree.worktreePath,
      ...(paths.taskFolder ? { taskFolder: paths.taskFolder } : {}),
      deliverables: paths.deliverables,
      subagentPtahTools: 'unavailable',
      startedAt,
      turnsSettled: 0,
      reportsDelivered: 0,
      reportsRefused: 0,
      task,
    };

    const runtime: ChildRuntime = { worktree, stopping: false };
    try {
      this.registry.add(record, guard.reservation);
      this.runtimes.set(childTabId, runtime);
      runtime.releasePolicy = this.policies.register(childTabId, {
        bashAllowlist: guard.settings.bashAllowlist,
        writableRoot: worktree.worktreePath,
        denyWindowMs: guard.settings.permissionDenyWindowMs,
        ownerLabel: `child session ${label}`,
      });
      await this.retainMcpRoot(childTabId, runtime, worktree.worktreePath);

      const contract = renderSessionChildContract({
        parentLabel: `session ${guard.caller}`,
        label,
        branch,
        worktreePath: worktree.worktreePath,
        bashAllowlist: guard.settings.bashAllowlist,
        denyWindowMs: guard.settings.permissionDenyWindowMs,
        ...(paths.taskFolder ? { taskFolder: paths.taskFolder } : {}),
        deliverables: paths.deliverables,
      });
      const stored = this.registry.get(childTabId) ?? record;
      const outcome = await this.startOnHost(guard.host, {
        tabId: childTabId,
        workspaceRoot: root,
        worktreePath: worktree.worktreePath,
        prompt: composeSessionChildPrompt(contract, task),
        descriptor: this.descriptorOf(stored),
        sessionName: label,
        ...(request.model ? { model: request.model } : {}),
      });
      if (!outcome.started) {
        return await this.failStart(childTabId, runtime, outcome.error);
      }

      runtime.runtimeTimer = this.armTimer(
        guard.settings.maxRuntimeMinutes * 60_000,
        () =>
          this.onRuntimeExceeded(childTabId, guard.settings.maxRuntimeMinutes),
      );
      this.log(
        `started ${childTabId} (${label}) for ${guard.caller} on ${branch} in ` +
          `${worktree.worktreePath}; tab announced: ${outcome.uiAnnounced}`,
      );
      const live = this.registry.get(childTabId) ?? stored;
      return { ok: true, child: this.snapshotOf(live) };
    } catch (error: unknown) {
      // degradation-audit: reported - an unexpected failure after the
      // worktree exists is rolled back and returned as `session-start-failed`
      // with the per-step table.
      return await this.failStart(childTabId, runtime, errorMessage(error));
    }
  }

  /** The parent root, inside the open folders. */
  private resolveRoot(): string | StartRefusal {
    let root: string | undefined;
    try {
      root = this.environment.scopedWorkspaceRoot();
    } catch (error: unknown) {
      // degradation-audit: reported - the caller declared a workspace this
      // host does not have open; refused by name as `no-workspace`.
      return this.refuseStart('no-workspace', errorMessage(error));
    }
    if (!root) {
      return this.refuseStart('no-workspace', 'no workspace folder is open');
    }
    if (!isPathWithinRoots(root, this.workspace.getWorkspaceFolders())) {
      return this.refuseStart(
        'no-workspace',
        `the workspace root ${root} is not inside an open folder`,
      );
    }
    return root;
  }

  private async startOnHost(
    host: IChildChatSessionHost,
    input: Parameters<IChildChatSessionHost['startChildSession']>[0],
  ): Promise<ChildChatSessionStartOutcome> {
    try {
      return await host.startChildSession(input);
    } catch (error: unknown) {
      // degradation-audit: reported - a throwing host is the same outcome as
      // `started: false`: the caller rolls back and reports the reason.
      return { started: false, error: errorMessage(error) };
    }
  }

  private async retainMcpRoot(
    childTabId: string,
    runtime: ChildRuntime,
    worktreePath: string,
  ): Promise<void> {
    if (!this.rootRegistrar) {
      this.log(
        `${childTabId}: no MCP root registrar; subagent Ptah tools unavailable`,
      );
      return;
    }
    try {
      const retention = await this.rootRegistrar.retainRoot(worktreePath);
      if (retention.registered) {
        runtime.mcpRoot = worktreePath;
        this.registry.update(childTabId, { subagentPtahTools: 'available' });
      } else {
        this.log(
          `${childTabId}: MCP root not retained (${retention.reason ?? 'no reason given'}); ` +
            'subagent Ptah tools unavailable',
        );
      }
    } catch (error: unknown) {
      // degradation-audit: optional-capability - the child still starts; its
      // status reports subagent Ptah tools as unavailable.
      this.log(`${childTabId}: MCP root retain failed: ${errorMessage(error)}`);
    }
  }

  /** Reverse rollback of everything this start created, every step reported. */
  private async failStart(
    childTabId: string,
    runtime: ChildRuntime,
    error: string,
  ): Promise<SessionChildStartResult> {
    this.log(`start of ${childTabId} failed: ${error}; rolling back`);
    const rollback: SessionChildRollbackStep[] = [];
    this.clearTimers(runtime);
    if (runtime.mcpRoot) {
      rollback.push(await this.releaseMcpRoot(runtime.mcpRoot));
      runtime.mcpRoot = undefined;
    }
    if (runtime.releasePolicy) {
      runtime.releasePolicy();
      runtime.releasePolicy = undefined;
      rollback.push({ step: 'release-policy', ok: true });
    }
    this.runtimes.delete(childTabId);
    const removed = this.registry.remove(childTabId);
    rollback.push({
      step: 'remove-link',
      ok: removed,
      ...(removed ? {} : { detail: 'the child link was never recorded' }),
    });
    rollback.push(...(await this.provisioner.rollback(runtime.worktree)));
    for (const step of rollback) {
      this.log(
        `rollback ${step.step}: ${step.ok ? 'ok' : `FAILED${step.detail ? ` (${step.detail})` : ''}`}`,
      );
    }
    return {
      ok: false,
      refusal: 'session-start-failed',
      detail: error,
      rollback,
    };
  }

  /* ------------------------------------------------------------------------
   * send / status / read / stop
   * ---------------------------------------------------------------------- */

  async send(
    request: SessionChildSendRequest,
  ): Promise<SessionChildSendResult> {
    const owned = this.resolveOwned(
      request.callerSessionId,
      request.childSessionId,
    );
    if (!owned.ok) {
      return {
        delivered: false,
        reason: owned.refusal.reason,
        detail: owned.refusal.detail,
      };
    }
    const { child, caller } = owned;
    const target = this.activeIdOf(child);
    if (child.terminalStatus || !target || !this.adapter) {
      return {
        delivered: false,
        reason: 'session-ended',
        detail:
          `child ${child.childSessionId} is not running` +
          (child.endReason ? ` (${child.endReason})` : '') +
          '; the user can resume it from its tab',
      };
    }
    const adapter = this.adapter;
    const origin: AIMessageOrigin = {
      kind: 'peer',
      from: `ptah-session:${caller}`,
      name: 'parent session',
    };
    const busy = this.phaseOf(child) === 'generating';

    try {
      switch (request.mode) {
        case 'if-idle':
          await adapter.sendMessageToSession(target, request.message, {
            origin,
            admission: 'require-idle',
          });
          return this.sent(child, request.mode, 'started-turn');
        case 'steer': {
          if (!busy) {
            await adapter.sendMessageToSession(target, request.message, {
              origin,
            });
            return this.sent(child, request.mode, 'started-turn');
          }
          const interrupted = await this.interruptTurn(adapter, target);
          if (!interrupted.ok) {
            return {
              delivered: false,
              reason: 'interrupt-failed',
              detail: `the current turn could not be interrupted${interrupted.detail}; nothing was sent`,
            };
          }
          await adapter.sendMessageToSession(target, request.message, {
            origin,
          });
          return this.sent(child, request.mode, 'interrupted-and-started');
        }
        case 'queue':
        default:
          await adapter.sendMessageToSession(target, request.message, {
            origin,
          });
          return this.sent(
            child,
            request.mode,
            busy ? 'held-until-turn-end' : 'started-turn',
          );
      }
    } catch (error: unknown) {
      // degradation-audit: reported - every send failure is returned to the
      // parent as a closed refusal reason with the error text.
      this.log(
        `send to ${child.childSessionId} failed: ${errorMessage(error)}`,
      );
      if (error instanceof SessionAdmissionRefusedError) {
        return {
          delivered: false,
          reason: error.reason,
          detail:
            error.reason === 'busy'
              ? 'the child is mid-turn or has a message queued; nothing was queued (use mode "queue" to wait)'
              : error.message,
        };
      }
      return {
        delivered: false,
        reason: 'delivery-failed',
        detail: errorMessage(error),
      };
    }
  }

  status(
    query: SessionChildQuery,
  ):
    | { readonly ok: true; readonly children: readonly SessionChildSnapshot[] }
    | SessionChildLookupRefusal {
    if (query.childSessionId !== undefined) {
      const owned = this.resolveOwned(
        query.callerSessionId,
        query.childSessionId,
      );
      if (!owned.ok) return owned.refusal;
      return { ok: true, children: [this.snapshotOf(owned.child)] };
    }
    const caller = SessionId.safeParse(query.callerSessionId?.trim());
    if (!caller) return unattributed();
    const children = this.registry
      .childrenOf([caller, this.sdkIdOf(caller)])
      .map((child) => this.snapshotOf(child));
    return { ok: true, children };
  }

  async read(
    query: SessionChildQuery & {
      readonly childSessionId: string;
      readonly tailKiB?: number;
    },
  ): Promise<
    | { readonly ok: true; readonly result: SessionChildReadResult }
    | SessionChildLookupRefusal
  > {
    const owned = this.resolveOwned(
      query.callerSessionId,
      query.childSessionId,
    );
    if (!owned.ok) return owned.refusal;
    const { child } = owned;
    const snapshot = this.snapshotOf(child);
    const tailKiB = clampTail(query.tailKiB);

    if (!child.sdkSessionId) {
      return {
        ok: true,
        result: {
          child: snapshot,
          transcript:
            'No transcript yet: the child has not been assigned its SDK session id.',
          truncated: false,
          available: false,
        },
      };
    }
    let text = '';
    try {
      text = await this.transcripts.read(
        child.sdkSessionId,
        child.worktreePath,
        {
          tailBytes: tailKiB * TRANSCRIPT_BYTES_PER_OUTPUT_KIB,
        },
      );
    } catch (error: unknown) {
      // degradation-audit: reported - the result says `available: false`.
      this.log(
        `transcript read for ${child.childSessionId} failed: ${errorMessage(error)}`,
      );
    }
    if (!text) {
      return {
        ok: true,
        result: {
          child: snapshot,
          transcript: 'The transcript could not be read yet.',
          truncated: false,
          available: false,
        },
      };
    }
    const limit = tailKiB * 1024;
    const truncated = text.length > limit;
    return {
      ok: true,
      result: {
        child: snapshot,
        transcript: truncated ? text.slice(-limit) : text,
        truncated,
        available: true,
      },
    };
  }

  async stop(
    query: SessionChildQuery & { readonly childSessionId: string },
  ): Promise<
    | { readonly ok: true; readonly child: SessionChildSnapshot }
    | SessionChildLookupRefusal
  > {
    const owned = this.resolveOwned(
      query.callerSessionId,
      query.childSessionId,
    );
    if (!owned.ok) return owned.refusal;
    const { child } = owned;
    const id = child.childSessionId;
    if (child.terminalStatus) {
      return { ok: true, child: this.snapshotOf(child) };
    }
    const runtime = this.runtimes.get(id);
    if (runtime) runtime.stopping = true;

    let reason = 'stopped-by-parent';
    const tabId = SessionId.safeParse(id);
    if (this.adapter && tabId) {
      try {
        await this.adapter.interruptSession(tabId);
      } catch (error: unknown) {
        // degradation-audit: reported - the child is still marked stopped;
        // the interrupt error is recorded in its end reason.
        reason = `stopped-by-parent (interrupt failed: ${errorMessage(error)})`;
      }
    }
    this.registry.markEnded(id, 'stopped', reason);
    this.releaseResources(id);
    this.log(
      `stopped ${id} (${child.label}): ${reason}; tab, worktree and branch kept`,
    );
    return { ok: true, child: this.snapshotOf(this.registry.get(id) ?? child) };
  }

  listUiDescriptors(
    workspaceRoot?: string,
  ): readonly AgentSessionOpenedPayload[] {
    const key =
      workspaceRoot === undefined
        ? undefined
        : normalizeWorkspaceRoot(workspaceRoot);
    return this.registry
      .live()
      .filter(
        (child) =>
          key === undefined ||
          normalizeWorkspaceRoot(child.workspaceRoot) === key,
      )
      .map((child) => this.descriptorOf(child));
  }

  takeHeldCompletions(
    callerSessionId: string | undefined,
  ): readonly SessionChildCompletionEnvelope[] {
    const caller = SessionId.safeParse(callerSessionId?.trim());
    if (!caller) return [];
    const envelopes: SessionChildCompletionEnvelope[] = [];
    for (const child of this.registry.childrenOf([
      caller,
      this.sdkIdOf(caller),
    ])) {
      const held = child.heldCompletion;
      if (!held) continue;
      envelopes.push(held.envelope);
      this.registry.update(child.childSessionId, {
        heldCompletion: undefined,
        lastCompletion: {
          turn: held.envelope.turn,
          verdict: held.envelope.verdict,
          delivered: true,
        },
      });
      this.log(
        `held completion of ${child.childSessionId} (turn ${held.envelope.turn}) handed to ${caller}`,
      );
    }
    return envelopes;
  }

  /**
   * Sync and idempotent. Live children end as `stopped (host-shutdown)` with
   * no completion push; their sessions are interrupted without awaiting.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const release of this.disposers.splice(0)) release();
    for (const child of this.registry.live()) {
      const runtime = this.runtimes.get(child.childSessionId);
      if (runtime) runtime.stopping = true;
      this.registry.markEnded(child.childSessionId, 'stopped', 'host-shutdown');
      this.releaseResources(child.childSessionId);
      this.interruptInBackground(child.childSessionId);
    }
    for (const runtime of this.runtimes.values()) this.clearTimers(runtime);
    this.runtimes.clear();
    this.log('disposed');
  }

  /* ------------------------------------------------------------------------
   * Event handlers (host-wide, subscribed once)
   * ---------------------------------------------------------------------- */

  private onTurnEnded(event: SdkAdapterTurnEndedEvent): void {
    const child = this.liveChildForEvent(event.sessionId, event.cwd);
    if (!child) return;
    const runtime = this.runtimes.get(child.childSessionId);
    if (!runtime || runtime.lastSettleTimestamp === event.timestamp) return;
    if (event.backgroundTasks.length > 0) {
      this.log(
        `${child.childSessionId} turn ended with ${event.backgroundTasks.length} background task(s); waiting, no push`,
      );
      return;
    }
    if (this.hasRunningLane(child)) {
      this.log(
        `${child.childSessionId} turn ended while its CLI lanes run; waiting, no push`,
      );
      return;
    }
    runtime.lastSettleTimestamp = event.timestamp;
    void this.settle(
      child.childSessionId,
      'completed',
      event.lastAssistantMessage,
      event.timestamp,
    );
  }

  private onTurnFailed(event: SdkAdapterTurnFailedEvent): void {
    const child = this.liveChildForEvent(event.sessionId, event.cwd);
    if (!child) return;
    const runtime = this.runtimes.get(child.childSessionId);
    if (!runtime || runtime.lastSettleTimestamp === event.timestamp) return;
    runtime.lastSettleTimestamp = event.timestamp;
    void this.settle(
      child.childSessionId,
      'failed',
      event.lastAssistantMessage,
      event.timestamp,
    );
  }

  private onSessionIdResolved(payload: SessionIdResolvedPayload): void {
    const tabId = payload.tabId;
    if (!tabId) return;
    const child = this.registry.get(tabId);
    if (!child || child.childSessionId !== tabId) return;
    this.registry.bindSdkSessionId(tabId, payload.realSessionId);
    this.log(`${tabId} bound to SDK session ${payload.realSessionId}`);
    const runtime = this.runtimes.get(tabId);
    if (runtime?.graceTimer) {
      clearTimeout(runtime.graceTimer);
      runtime.graceTimer = undefined;
      this.log(`${tabId} re-registered; grace cancelled`);
    }
  }

  private onSessionEnd(payload: SessionEndPayload): void {
    const child = this.registry.get(payload.sessionId);
    if (!child || child.terminalStatus) return;
    const runtime = this.runtimes.get(child.childSessionId);
    if (!runtime || runtime.stopping) return;
    const wasWorking = this.phaseOf(child) === 'generating';
    if (runtime.graceTimer) clearTimeout(runtime.graceTimer);
    runtime.graceTimer = this.armTimer(SESSION_CHILD_GRACE_MS, () =>
      this.onGraceExpired(child.childSessionId, wasWorking),
    );
    this.log(
      `${child.childSessionId} session ended; ${SESSION_CHILD_GRACE_MS / 1000}s grace armed`,
    );
  }

  private onGraceExpired(childSessionId: string, wasWorking: boolean): void {
    const runtime = this.runtimes.get(childSessionId);
    if (runtime) runtime.graceTimer = undefined;
    const child = this.registry.get(childSessionId);
    if (!child || child.terminalStatus) return;
    if (this.activeIdOf(child)) {
      this.log(
        `${childSessionId} is live again after its session end; grace expired harmlessly`,
      );
      return;
    }
    if (wasWorking) {
      void this.settle(childSessionId, 'failed', undefined, Date.now());
    }
    this.registry.markEnded(
      childSessionId,
      'ended',
      'ended outside the spawner: stop button, error or teardown',
    );
    this.releaseResources(childSessionId);
    this.log(
      `${childSessionId} ended (grace expired); slot, policy and MCP root released`,
    );
  }

  private onRuntimeExceeded(childSessionId: string, minutes: number): void {
    const child = this.registry.get(childSessionId);
    const runtime = this.runtimes.get(childSessionId);
    if (!child || child.terminalStatus || !runtime) return;
    runtime.runtimeTimer = undefined;
    if (this.phaseOf(child) === 'generating') {
      void this.settle(childSessionId, 'timeout', undefined, Date.now());
    }
    runtime.stopping = true;
    this.registry.markEnded(
      childSessionId,
      'timed-out',
      `exceeded the ${minutes}-minute runtime cap (agentSessions.maxRuntimeMinutes)`,
    );
    this.releaseResources(childSessionId);
    this.interruptInBackground(childSessionId);
    this.log(
      `${childSessionId} timed out after ${minutes} minutes; interrupted`,
    );
  }

  private onPromptLifecycle(event: PermissionPromptLifecycleEvent): void {
    const child = this.registry.get(event.routingHint);
    if (!child || child.terminalStatus) return;
    const runtime = this.runtimes.get(child.childSessionId);
    if (!runtime) return;
    if (event.phase === 'requested') {
      runtime.pendingRequestId = event.requestId;
      this.registry.update(child.childSessionId, {
        pendingPermission: {
          toolName: event.toolName,
          description: event.description,
          deniesAt:
            event.timeoutMs === undefined
              ? 'unbounded'
              : new Date(Date.now() + event.timeoutMs).toISOString(),
        },
      });
      this.log(`${child.childSessionId} asks permission for ${event.toolName}`);
      return;
    }
    if (runtime.pendingRequestId !== event.requestId) return;
    runtime.pendingRequestId = undefined;
    this.registry.update(child.childSessionId, {
      pendingPermission: undefined,
    });
    this.log(
      `${child.childSessionId} permission for ${event.toolName}: ${event.outcome}`,
    );
  }

  /* ------------------------------------------------------------------------
   * Settle → completion push or hold
   * ---------------------------------------------------------------------- */

  private async settle(
    childSessionId: string,
    status: SessionChildSettle['status'],
    recap: string | null | undefined,
    timestampMs: number,
  ): Promise<void> {
    const current = this.registry.get(childSessionId);
    if (!current) return;
    const turn = current.turnsSettled + 1;
    const lastRecap = recap?.trim();
    const child =
      this.registry.update(childSessionId, {
        turnsSettled: turn,
        ...(lastRecap ? { lastRecap } : {}),
      }) ?? current;
    let delivery: SessionChildCompletionDelivery;
    try {
      delivery = await this.notifier.signalSessionChild(
        {
          childSessionId,
          label: child.label,
          parentSessionIds: [
            child.parentSessionId,
            child.parentSdkSessionId,
          ].filter((id): id is string => !!id),
          task: child.task,
          ...(child.taskFolder ? { taskFolder: child.taskFolder } : {}),
          deliverables: child.deliverables,
          worktreePath: child.worktreePath,
          branch: child.branch,
          startedAt: child.startedAt,
          reportsDelivered: child.reportsDelivered,
          ...(child.lastRecap ? { lastRecap: child.lastRecap } : {}),
        },
        { turn, status, completedAt: new Date(timestampMs).toISOString() },
      );
    } catch (error: unknown) {
      // degradation-audit: reported - the notifier result-shapes its own
      // failures; a throw here is logged and the turn stays counted.
      this.log(
        `completion of ${childSessionId} turn ${turn} failed: ${errorMessage(error)}`,
      );
      return;
    }
    this.recordDelivery(childSessionId, turn, delivery);
  }

  private recordDelivery(
    childSessionId: string,
    turn: number,
    delivery: SessionChildCompletionDelivery,
  ): void {
    if (delivery.delivered) {
      this.registry.update(childSessionId, {
        heldCompletion: undefined,
        lastCompletion: {
          turn,
          verdict: delivery.envelope.verdict,
          delivered: true,
        },
      });
      this.log(
        `${childSessionId} turn ${turn} settled (${delivery.envelope.verdict}); delivered to ${delivery.parentSessionId}`,
      );
      return;
    }
    if (delivery.reason === 'already-signalled') return;
    const refusal = delivery.detail
      ? `${delivery.reason}: ${delivery.detail}`
      : delivery.reason;
    // Latest wins: a newer settle replaces an older held completion.
    this.registry.update(childSessionId, {
      heldCompletion: {
        heldSince: new Date().toISOString(),
        envelope: delivery.envelope,
      },
      lastCompletion: {
        turn,
        verdict: delivery.envelope.verdict,
        delivered: false,
        refusal,
      },
    });
    this.log(
      `${childSessionId} turn ${turn} settled (${delivery.envelope.verdict}); held for the parent (${refusal})`,
    );
  }

  /* ------------------------------------------------------------------------
   * Helpers
   * ---------------------------------------------------------------------- */

  private resolveOwned(
    callerSessionId: string | undefined,
    childSessionId: string,
  ): OwnedLookup {
    const caller = SessionId.safeParse(callerSessionId?.trim());
    if (!caller) return { ok: false, refusal: unattributed() };
    const child = this.registry.get(childSessionId);
    if (!child) {
      return {
        ok: false,
        refusal: {
          ok: false,
          reason: 'unknown-child',
          detail: `no child session ${childSessionId} is known to this host`,
        },
      };
    }
    const callerIds = new Set(
      [caller as string, this.sdkIdOf(caller)].filter(
        (id): id is string => !!id,
      ),
    );
    const owned =
      callerIds.has(child.parentSessionId) ||
      (!!child.parentSdkSessionId && callerIds.has(child.parentSdkSessionId));
    if (!owned) {
      return {
        ok: false,
        refusal: {
          ok: false,
          reason: 'not-a-child-of-caller',
          detail: `child session ${childSessionId} was started by another session`,
        },
      };
    }
    return { ok: true, child, caller };
  }

  /** A live child an SDK turn event belongs to; binds the SDK id when found by cwd. */
  private liveChildForEvent(
    sessionId: string,
    cwd: string,
  ): SessionChildRecord | undefined {
    let child = this.registry.get(sessionId);
    if (!child) {
      const byCwd = this.registry.findByCwd(cwd);
      if (!byCwd) return undefined;
      // Another session opened in the same worktree is not this child.
      if (byCwd.sdkSessionId && byCwd.sdkSessionId !== sessionId)
        return undefined;
      child = byCwd;
      if (!byCwd.sdkSessionId && sessionId) {
        child =
          this.registry.bindSdkSessionId(byCwd.childSessionId, sessionId) ??
          byCwd;
        this.log(
          `${byCwd.childSessionId} bound to SDK session ${sessionId} by cwd`,
        );
      }
    }
    if (child.terminalStatus) return undefined;
    const runtime = this.runtimes.get(child.childSessionId);
    if (!runtime || runtime.stopping) return undefined;
    return child;
  }

  private statusOf(child: SessionChildRecord): SessionChildStatus {
    if (child.terminalStatus) return child.terminalStatus;
    if (child.pendingPermission) return 'awaiting-permission';
    const phase = this.phaseOf(child);
    switch (phase) {
      case 'generating':
        return 'working';
      case 'awaiting-background':
      case 'sleeping':
        return 'waiting';
      case 'idle':
      case 'failed':
        return this.hasRunningLane(child) ? 'waiting' : 'idle';
      default:
        return 'starting';
    }
  }

  private phaseOf(child: SessionChildRecord): SessionTurnPhase | undefined {
    return (
      (child.sdkSessionId
        ? this.turnState.get(child.sdkSessionId)?.phase
        : undefined) ?? this.turnState.get(child.childSessionId)?.phase
    );
  }

  /** A Ptah CLI lane the child spawned is still running. */
  private hasRunningLane(child: SessionChildRecord): boolean {
    const ids = new Set(
      [child.childSessionId, child.sdkSessionId].filter(
        (id): id is string => !!id,
      ),
    );
    return this.agents
      .listTrackedAgents()
      .some(
        (agent) =>
          agent.status === 'running' &&
          !!agent.parentSessionId &&
          ids.has(agent.parentSessionId),
      );
  }

  /** The id the adapter knows the child's live session by, or null when it is not live. */
  private activeIdOf(child: SessionChildRecord): SessionId | null {
    if (!this.adapter) return null;
    for (const raw of [child.childSessionId, child.sdkSessionId]) {
      const id = SessionId.safeParse(raw);
      if (id && this.adapter.isSessionActive(id)) return id;
    }
    return null;
  }

  private sdkIdOf(sessionId: string): string | undefined {
    return this.lifecycle.find(sessionId)?.realSessionId ?? undefined;
  }

  private async interruptTurn(
    adapter: IAgentAdapter,
    target: SessionId,
  ): Promise<{ ok: boolean; detail: string }> {
    try {
      const ok = await adapter.interruptCurrentTurn(target);
      return { ok, detail: '' };
    } catch (error: unknown) {
      // degradation-audit: reported - returned as `interrupt-failed`.
      return { ok: false, detail: ` (${errorMessage(error)})` };
    }
  }

  private sent(
    child: SessionChildRecord,
    mode: SessionChildSendRequest['mode'],
    effect: Extract<SessionChildSendResult, { delivered: true }>['effect'],
  ): SessionChildSendResult {
    this.log(`message to ${child.childSessionId} (${mode}): ${effect}`);
    return { delivered: true, effect };
  }

  private snapshotOf(record: SessionChildRecord): SessionChildSnapshot {
    const snapshot: Record<string, unknown> = { ...record };
    delete snapshot['task'];
    delete snapshot['terminalStatus'];
    delete snapshot['heldCompletion'];
    const held = record.heldCompletion;
    return {
      ...(snapshot as Omit<SessionChildSnapshot, 'status' | 'heldCompletion'>),
      status: this.statusOf(record),
      ...(held
        ? {
            heldCompletion: {
              turn: held.envelope.turn,
              verdict: held.envelope.verdict,
              heldSince: held.heldSince,
            },
          }
        : {}),
    };
  }

  private descriptorOf(child: SessionChildRecord): AgentSessionOpenedPayload {
    return {
      tabId: child.childSessionId,
      sessionId: child.sdkSessionId ?? null,
      parentTabId: child.parentSessionId,
      parentSessionId: child.parentSdkSessionId ?? null,
      workspaceRoot: child.workspaceRoot,
      worktreePath: child.worktreePath,
      branch: child.branch,
      label: child.label,
      ...(child.taskId ? { taskId: child.taskId } : {}),
      displayPrompt: child.task,
      startedAt: Date.parse(child.startedAt),
    };
  }

  /** Clear timers and release the policy and MCP root of an ended child. */
  private releaseResources(childSessionId: string): void {
    const runtime = this.runtimes.get(childSessionId);
    if (!runtime) return;
    this.runtimes.delete(childSessionId);
    this.clearTimers(runtime);
    runtime.releasePolicy?.();
    runtime.releasePolicy = undefined;
    if (runtime.mcpRoot) {
      void this.releaseMcpRoot(runtime.mcpRoot);
      runtime.mcpRoot = undefined;
    }
  }

  private async releaseMcpRoot(
    root: string,
  ): Promise<SessionChildRollbackStep> {
    if (!this.rootRegistrar) return { step: 'release-mcp-root', ok: true };
    try {
      await this.rootRegistrar.releaseRoot(root);
      return { step: 'release-mcp-root', ok: true };
    } catch (error: unknown) {
      // degradation-audit: reported - a release failure never blocks an end
      // or a rollback; it is logged and reported in the rollback table.
      const detail = errorMessage(error);
      this.log(`MCP root release for ${root} failed: ${detail}`);
      return { step: 'release-mcp-root', ok: false, detail };
    }
  }

  private interruptInBackground(childSessionId: string): void {
    const id = SessionId.safeParse(childSessionId);
    if (!this.adapter || !id) return;
    this.adapter.interruptSession(id).catch((error: unknown) => {
      this.log(`interrupt of ${childSessionId} failed: ${errorMessage(error)}`);
    });
  }

  private clearTimers(runtime: ChildRuntime): void {
    if (runtime.runtimeTimer) clearTimeout(runtime.runtimeTimer);
    if (runtime.graceTimer) clearTimeout(runtime.graceTimer);
    runtime.runtimeTimer = undefined;
    runtime.graceTimer = undefined;
  }

  /** A timer that never keeps the host process alive on its own. */
  private armTimer(
    ms: number,
    fire: () => void,
  ): ReturnType<typeof setTimeout> {
    const timer = setTimeout(fire, ms);
    timer.unref?.();
    return timer;
  }

  /**
   * The chat host port as registered NOW (Task 6.6). `null` when there is no
   * container, nothing is registered yet, or construction throws; the caller
   * refuses `chat-runtime-unavailable` in every one of those cases.
   */
  private lookupHost(): IChildChatSessionHost | null {
    const token = CLI_AGENT_RUNTIME_TOKENS.CHILD_CHAT_SESSION_HOST;
    if (this.container === null || !this.container.isRegistered(token, true)) {
      return null;
    }
    try {
      return this.container.resolve<IChildChatSessionHost>(token);
    } catch (error: unknown) {
      // degradation-audit: reported - logged below; the start is refused as
      // `chat-runtime-unavailable`, which the parent reads as a closed reason.
      this.log(`chat host could not be resolved: ${errorMessage(error)}`);
      return null;
    }
  }

  private refuseStart(
    refusal: SessionSpawnRefusalCode,
    detail: string,
  ): StartRefusal {
    this.log(`start refused (${refusal}): ${detail}`);
    return { ok: false, refusal, detail };
  }

  private log(message: string): void {
    this.output.appendLine(`${LOG_PREFIX} ${message}`);
  }
}

/* --------------------------------------------------------------------------
 * Pure helpers
 * ------------------------------------------------------------------------ */

type ChildPaths =
  | {
      readonly ok: true;
      readonly taskFolder?: string;
      readonly deliverables: readonly string[];
    }
  | { readonly ok: false; readonly detail: string };

/**
 * Resolve the task folder and every deliverable inside the child's future
 * worktree. A relative deliverable resolves against the task folder when one
 * is given (where the contract tells the child to write), else the worktree.
 */
export function resolveChildPaths(
  worktreePath: string,
  request: Pick<SessionChildStartRequest, 'taskFolder' | 'deliverables'>,
): ChildPaths {
  let taskFolder: string | undefined;
  if (request.taskFolder !== undefined) {
    const folder = request.taskFolder.trim();
    if (!folder || isAbsolute(folder)) {
      return {
        ok: false,
        detail: 'taskFolder must be a relative path inside the worktree',
      };
    }
    taskFolder = resolve(worktreePath, folder);
    if (!isPathWithinRoots(taskFolder, [worktreePath])) {
      return {
        ok: false,
        detail: `taskFolder "${folder}" escapes the worktree`,
      };
    }
  }
  const deliverables: string[] = [];
  for (const entry of request.deliverables ?? []) {
    const value = entry.trim();
    if (!value) return { ok: false, detail: 'a deliverable path is empty' };
    const absolute = isAbsolute(value)
      ? resolve(value)
      : resolve(taskFolder ?? worktreePath, value);
    if (!isPathWithinRoots(absolute, [worktreePath])) {
      return {
        ok: false,
        detail: `deliverable "${value}" is outside the worktree`,
      };
    }
    deliverables.push(absolute);
  }
  return { ok: true, ...(taskFolder ? { taskFolder } : {}), deliverables };
}

function clampTail(tailKiB: number | undefined): number {
  if (tailKiB === undefined || !Number.isFinite(tailKiB)) {
    return SESSION_READ_DEFAULT_TAIL_KIB;
  }
  return Math.max(1, Math.min(SESSION_READ_MAX_TAIL_KIB, Math.floor(tailKiB)));
}

function unattributed(): SessionChildLookupRefusal {
  return {
    ok: false,
    reason: 'unattributed-caller',
    detail: 'this call carries no live chat session id',
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

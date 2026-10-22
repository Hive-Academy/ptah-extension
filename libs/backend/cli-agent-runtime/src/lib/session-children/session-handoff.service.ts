/**
 * `ISessionHandoff` (TASK_2026_655): a chat session hands its work to a NEW
 * top-level chat session in the same workspace and cwd, whose first user
 * message is the continuation prompt.
 *
 * The service only guards and asks the chat host port to start an ordinary
 * session; the new session is not a child (it is never in
 * `SessionChildRegistry`), so it can hand off again later. A child session is
 * refused: its parent supervises its work.
 *
 * No event subscriptions, so nothing needs disposing. Each start has one
 * deadline timer, cleared when the start settles or the deadline fires. The
 * state is a bounded record of callers that already handed off and the
 * callers whose start has not settled yet, both keyed by the caller's tab id.
 */
import { inject, injectable, type DependencyContainer } from 'tsyringe';
import { promises as fs } from 'node:fs';
import { isAbsolute } from 'node:path';
import {
  SDK_TOKENS,
  type SessionLifecycleManager,
} from '@ptah-extension/agent-sdk';
import {
  PLATFORM_TOKENS,
  isPathWithinRoots,
  type IMcpServerStatus,
  type IOutputChannel,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import {
  SessionId,
  type IAgentAdapter,
  type SessionHandoffOpenedPayload,
} from '@ptah-extension/shared';
import { TOKENS } from '@ptah-extension/vscode-core';
import { CLI_AGENT_RUNTIME_TOKENS } from '../di/tokens';
import type { IChildChatSessionHost } from './child-chat-session-host.port';
import { SessionChildRegistry } from './session-child.registry';
import { safeErrorKind } from './safe-error-kind';
import type {
  ISessionHandoff,
  SessionHandoffRefusalCode,
  SessionHandoffRequest,
  SessionHandoffResult,
} from './session-handoff.port';

const LOG_PREFIX = '[SessionHandoff]';

/** How many callers that already handed off are remembered; the oldest is forgotten first. */
export const SESSION_HANDOFF_HISTORY_SIZE = 64;
/** Longest tab label, in characters. */
export const SESSION_HANDOFF_LABEL_MAX = 60;
/** How long the host may take to start the new session before the call is refused. */
export const SESSION_HANDOFF_START_TIMEOUT_MS = 30_000;

/** Fixed details: host error text may quote the prompt, so it is never passed on. */
export const SESSION_HANDOFF_START_FAILED_DETAIL =
  'the host could not start the new session';
export const SESSION_HANDOFF_START_TIMEOUT_DETAIL =
  `the host did not confirm the new session within ` +
  `${SESSION_HANDOFF_START_TIMEOUT_MS / 1000} s; it may still open late, so ` +
  'look for it in the sessions panel before starting another one';
const UNEXPECTED_FAULT_DETAIL = 'an unexpected fault stopped the handoff';

const TIMED_OUT: unique symbol = Symbol('session-handoff-timed-out');

type CallerRecord = NonNullable<ReturnType<SessionLifecycleManager['find']>>;
type HandoffRefusal = Extract<SessionHandoffResult, { ok: false }>;

/** A caller that handed off: its ids and the tab it handed off to. */
interface HandedOff {
  readonly sdkSessionId: string | null;
  readonly tabId: string;
}

@injectable()
export class SessionHandoffService implements ISessionHandoff {
  /** Keyed by the caller's tab id, in insertion order (oldest first). */
  private readonly handedOff = new Map<string, HandedOff>();
  /**
   * Tab ids of callers whose start has not settled. A start that outlives
   * its deadline stays here until it settles, so a retry cannot open a
   * second session.
   */
  private readonly inFlight = new Set<string>();

  constructor(
    @inject(SessionChildRegistry)
    private readonly registry: SessionChildRegistry,
    @inject(SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER)
    private readonly lifecycle: SessionLifecycleManager,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(PLATFORM_TOKENS.OUTPUT_CHANNEL)
    private readonly output: IOutputChannel,
    /** Absent in a host without a chat runtime → `chat-runtime-unavailable`. */
    @inject(TOKENS.AGENT_ADAPTER, { isOptional: true })
    private readonly adapter: IAgentAdapter | null = null,
    /**
     * Where the chat host port is looked up, at call time and never here:
     * `registerChatServices` registers it in a later phase than this lib
     * (same reason as `SessionSpawnerService`).
     */
    @inject(PLATFORM_TOKENS.DI_CONTAINER, { isOptional: true })
    private readonly container: DependencyContainer | null = null,
    /** Absent or port-less (CLI host) → `mcp-unavailable`. */
    @inject(PLATFORM_TOKENS.MCP_SERVER_STATUS, { isOptional: true })
    private readonly mcpStatus: IMcpServerStatus | null = null,
  ) {}

  async handoff(request: SessionHandoffRequest): Promise<SessionHandoffResult> {
    try {
      return await this.guardAndStart(request);
    } catch (error: unknown) {
      // degradation-audit: reported - an unexpected fault in a collaborator
      // is logged and returned as the closed `session-start-failed`, so the
      // tool never throws and the skill falls back to printing the prompt.
      // Only the error's kind is logged: its message may quote the request.
      this.log(`handoff faulted: ${safeErrorKind(error)}`);
      return this.refuse('session-start-failed', UNEXPECTED_FAULT_DETAIL);
    }
  }

  private async guardAndStart(
    request: SessionHandoffRequest,
  ): Promise<SessionHandoffResult> {
    const host = this.lookupHost();
    if (!host || !this.adapter) {
      return this.refuse(
        'chat-runtime-unavailable',
        'this host has no chat runtime to open a new session in',
      );
    }
    const caller = SessionId.safeParse(request.callerSessionId?.trim());
    const record = caller ? this.lifecycle.find(caller) : undefined;
    if (!caller || !record) {
      return this.refuse(
        'unattributed-caller',
        'ptah_session_handoff must be called from a live chat session; this ' +
          'caller has no live session id',
      );
    }
    if (
      this.registry.isChild(caller) ||
      this.registry.isChild(record.realSessionId ?? undefined)
    ) {
      return this.refuse(
        'child-session',
        'a child session cannot hand off; its parent session supervises its work',
      );
    }
    if ((this.mcpStatus?.getPort() ?? null) === null) {
      return this.refuse(
        'mcp-unavailable',
        'the Ptah MCP server is not running in this host, so the new session ' +
          'could not hand off again',
      );
    }
    const paths = this.resolvePaths(record);
    if (!paths.ok) return paths;
    const handoffFile = await this.checkHandoffFile(request.handoffPath);
    if (handoffFile) return handoffFile;

    // The caller may be named by its tab id or its SDK id; both resolve to
    // one record, whose tab id keys every duplicate check and reservation.
    const key = record.tabId;
    const earlier = this.findHandedOff(key, record.realSessionId);
    if (earlier) {
      return this.refuse(
        'already-handed-off',
        `this session already handed off to tab ${earlier.tabId}`,
      );
    }
    if (this.inFlight.has(key)) {
      return this.refuse(
        'already-handed-off',
        'a handoff from this session is already in progress',
      );
    }
    this.inFlight.add(key);
    // Never rejects; releases the reservation only when the start settles,
    // even after the deadline below has answered the caller.
    const attempt = this.start(host, request, record, paths)
      .catch((error: unknown) => {
        // degradation-audit: reported - logged by kind only (its message may
        // quote the prompt) and returned as the closed `session-start-failed`.
        this.log(`handoff start faulted: ${safeErrorKind(error)}`);
        return this.refuse(
          'session-start-failed',
          SESSION_HANDOFF_START_FAILED_DETAIL,
        );
      })
      .finally(() => this.inFlight.delete(key));
    const result = await withDeadline(
      attempt,
      SESSION_HANDOFF_START_TIMEOUT_MS,
    );
    if (result === TIMED_OUT) {
      return this.refuse(
        'session-start-failed',
        SESSION_HANDOFF_START_TIMEOUT_DETAIL,
      );
    }
    return result;
  }

  private async start(
    host: IChildChatSessionHost,
    request: SessionHandoffRequest,
    record: CallerRecord,
    paths: { readonly root: string; readonly cwd: string },
  ): Promise<SessionHandoffResult> {
    const tabId = SessionId.create();
    const label = truncate(
      request.label?.trim() ||
        `Continued: ${record.config.sessionName?.trim() || 'session'}`,
      SESSION_HANDOFF_LABEL_MAX,
    );
    const descriptor: SessionHandoffOpenedPayload = {
      tabId,
      fromTabId: record.tabId,
      fromSessionId: record.realSessionId,
      workspaceRoot: paths.root,
      cwd: paths.cwd,
      label,
      displayPrompt: request.prompt,
      startedAt: Date.now(),
    };
    let outcome: Awaited<
      ReturnType<IChildChatSessionHost['startHandoffSession']>
    >;
    try {
      outcome = await host.startHandoffSession({
        tabId,
        workspaceRoot: paths.root,
        cwd: paths.cwd,
        prompt: request.prompt,
        sessionName: label,
        descriptor,
        ...(record.currentModel ? { model: record.currentModel } : {}),
        permissionLevel: record.permissionLevel,
      });
    } catch (error: unknown) {
      // degradation-audit: reported - the port's contract is never-throw; a
      // throw means the session did not start. Its message may quote the
      // prompt, so only its kind is logged and the detail is fixed.
      this.log(`host start threw: ${safeErrorKind(error)}`);
      return this.refuse(
        'session-start-failed',
        SESSION_HANDOFF_START_FAILED_DETAIL,
      );
    }
    if (!outcome.started) {
      // The host's error text may quote the prompt: it is not passed on.
      this.log('host reported that the new session did not start');
      return this.refuse(
        'session-start-failed',
        SESSION_HANDOFF_START_FAILED_DETAIL,
      );
    }
    this.remember(record.tabId, {
      sdkSessionId: record.realSessionId,
      tabId,
    });
    this.log(
      `${record.tabId} handed off to ${tabId} in ${paths.cwd}` +
        (outcome.uiAnnounced ? '' : ' (no webview took the tab)'),
    );
    return {
      ok: true,
      tabId,
      label,
      workspaceRoot: paths.root,
      cwd: paths.cwd,
      tabOpened: outcome.uiAnnounced,
    };
  }

  /** The caller's cwd and root, both inside an open workspace folder. */
  private resolvePaths(
    record: CallerRecord,
  ):
    | { readonly ok: true; readonly root: string; readonly cwd: string }
    | HandoffRefusal {
    const cwd = record.config.projectPath?.trim();
    if (!cwd) {
      return this.refuse(
        'no-workspace',
        'the calling session has no working directory',
      );
    }
    const root = record.config.workspaceId?.trim() || cwd;
    const folders = this.workspace.getWorkspaceFolders();
    for (const path of [cwd, root]) {
      if (!isPathWithinRoots(path, folders)) {
        return this.refuse(
          'no-workspace',
          `${path} is not inside a workspace folder open in this host`,
        );
      }
    }
    return { ok: true, root, cwd };
  }

  /**
   * `null` when `handoffPath` is an absolute path to a regular file inside an
   * open workspace folder: proof the skill wrote its handoff file first.
   */
  private async checkHandoffFile(
    handoffPath: string,
  ): Promise<HandoffRefusal | null> {
    const path = handoffPath.trim();
    if (!path || !isAbsolute(path)) {
      return this.refuse(
        'handoff-file-missing',
        `handoffPath must be an absolute path; got "${path}"`,
      );
    }
    if (!isPathWithinRoots(path, this.workspace.getWorkspaceFolders())) {
      return this.refuse(
        'handoff-file-missing',
        `${path} is not inside a workspace folder open in this host`,
      );
    }
    try {
      const stat = await fs.stat(path);
      if (stat.isFile()) return null;
      return this.refuse('handoff-file-missing', `${path} is not a file`);
    } catch (error: unknown) {
      // degradation-audit: reported - a missing or unreadable file is the
      // closed `handoff-file-missing`; the detail names the path.
      return this.refuse(
        'handoff-file-missing',
        `${path} could not be read (${safeErrorKind(error)})`,
      );
    }
  }

  private findHandedOff(
    callerTabId: string,
    callerSdkId: string | null,
  ): HandedOff | undefined {
    const byTab = this.handedOff.get(callerTabId);
    if (byTab) return byTab;
    if (!callerSdkId) return undefined;
    for (const entry of this.handedOff.values()) {
      if (entry.sdkSessionId === callerSdkId) return entry;
    }
    return undefined;
  }

  private remember(callerTabId: string, entry: HandedOff): void {
    this.handedOff.delete(callerTabId);
    this.handedOff.set(callerTabId, entry);
    while (this.handedOff.size > SESSION_HANDOFF_HISTORY_SIZE) {
      const oldest = this.handedOff.keys().next().value;
      if (oldest === undefined) break;
      this.handedOff.delete(oldest);
    }
  }

  /**
   * The chat host port as registered NOW. `null` when there is no container,
   * nothing is registered yet, or construction throws.
   */
  private lookupHost(): IChildChatSessionHost | null {
    const token = CLI_AGENT_RUNTIME_TOKENS.CHILD_CHAT_SESSION_HOST;
    if (this.container === null || !this.container.isRegistered(token, true)) {
      return null;
    }
    try {
      return this.container.resolve<IChildChatSessionHost>(token);
    } catch (error: unknown) {
      // degradation-audit: reported - logged below; the handoff is refused
      // as `chat-runtime-unavailable`, a closed reason the caller reads.
      this.log(`chat host could not be resolved: ${safeErrorKind(error)}`);
      return null;
    }
  }

  /** Logs the refusal; the prompt text is never part of a detail. */
  private refuse(
    refusal: SessionHandoffRefusalCode,
    detail: string,
  ): HandoffRefusal {
    this.log(`handoff refused (${refusal}): ${detail}`);
    return { ok: false, refusal, detail };
  }

  /** Never throws: a failing output channel must not change the result. */
  private log(message: string): void {
    try {
      this.output.appendLine(`${LOG_PREFIX} ${message}`);
    } catch {
      // degradation-audit: optional-capability - the output channel is optional;
      // a lost log line keeps the never-throw port.
    }
  }
}

/** `work`'s value, or `TIMED_OUT` after `ms`. The timer is always cleared. */
async function withDeadline<T>(
  work: Promise<T>,
  ms: number,
): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

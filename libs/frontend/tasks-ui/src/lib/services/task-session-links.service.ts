import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import {
  AppStateManager,
  ClaudeRpcService,
  type MessageHandler,
} from '@ptah-extension/core';
import {
  MESSAGE_TYPES,
  type SessionPrLinkSummary,
  type SessionTurnPhase,
  type TaskLinkedSession,
} from '@ptah-extension/shared';

/** The map a task board reads: task id → its linked sessions, in host order. */
export type TaskSessionLinkMap = ReadonlyMap<
  string,
  readonly TaskLinkedSession[]
>;

const EMPTY_LINKS: readonly TaskLinkedSession[] = [];
const EMPTY_MAP: TaskSessionLinkMap = new Map();

const TURN_PHASES: ReadonlySet<string> = new Set<SessionTurnPhase>([
  'generating',
  'awaiting-background',
  'sleeping',
  'idle',
  'failed',
]);

/** Pushes whose payload names one session; a session no task links to is skipped. */
const SESSION_TURN_PUSHES: ReadonlySet<string> = new Set([
  MESSAGE_TYPES.SESSION_TURN_ENDED,
  MESSAGE_TYPES.SESSION_TURN_FAILED,
]);

/**
 * The sessions linked to each task on the board (TASK_2026_580, C.3).
 *
 * ## One fetch for the whole board
 *
 * `session:listForTasks` answers for every linked task in one round trip, and
 * every card reads its slice through {@link linksFor}. A card never fetches
 * and never runs a timer; it only {@link retain}s the service while mounted.
 *
 * ## When it fetches
 *
 * - The Tasks surface opens (a board load). This fires when the view is
 *   entered, in parallel with the board's own `tasks:board` scan, so the
 *   links normally land before the cards render and the cards do not grow
 *   under the user (no layout shift from a late row).
 * - The first card mounts (0 → 1 consumers) when nothing has fetched since
 *   the surface opened: a board rendered outside the Tasks surface.
 * - `session:organizationChanged`, `session:turnEnded`, `session:turnFailed`
 *   arrive while the surface is open or a card is mounted, so live phases
 *   settle when turns do. A turn push for a session that no task links to
 *   cannot change the map and is skipped.
 * - The active workspace changes while the surface is open or a card is
 *   mounted.
 *
 * Cards unmounting and remounting inside one visit (a filter change) fetch
 * nothing. The last map is kept across visits, so a returning board shows
 * its previous rows at once while the visit's fetch refreshes them. A push
 * that arrives with nothing open is dropped: the next visit fetches.
 * Triggers that land while a fetch is in flight coalesce into one more fetch.
 *
 * ## Failure and unsupported hosts
 *
 * A host without the organization store (VS Code) answers
 * `{ available: false }`; that, a failed call, or a malformed answer all leave
 * the map empty, so cards render no sessions row. A failure logs one console
 * error.
 *
 * Registered in `MESSAGE_HANDLERS` by the webview's `app.config.ts`.
 */
@Injectable({ providedIn: 'root' })
export class TaskSessionLinksService implements MessageHandler {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly appState = inject(AppStateManager);

  public readonly handledMessageTypes = [
    MESSAGE_TYPES.SESSION_ORGANIZATION_CHANGED,
    MESSAGE_TYPES.SESSION_TURN_ENDED,
    MESSAGE_TYPES.SESSION_TURN_FAILED,
  ] as const;

  private readonly _links = signal<TaskSessionLinkMap>(EMPTY_MAP);

  /** Every linked task's sessions. Read through {@link linksFor} in a template. */
  public readonly links = this._links.asReadonly();

  private consumers = 0;
  private inFlight = false;
  private reloadQueued = false;
  private lastWorkspacePath: string | null;
  private onTasksView = false;
  /** A fetch was issued during this visit (or this run of mounted cards). */
  private fetchedThisVisit = false;

  public constructor() {
    // Seeded here so the effect's first run is not a "switch" that clears and
    // refetches a map a consumer may already be loading.
    this.lastWorkspacePath = this.appState.workspaceInfo()?.path ?? null;
    effect(() => {
      const path = this.appState.workspaceInfo()?.path ?? null;
      const onTasksView = this.appState.currentView() === 'tasks';
      untracked(() => this.onContextChange(path, onTasksView));
    });
  }

  /**
   * The sessions linked to `taskId`, primary first and then newest. Reactive:
   * a `computed` that calls it re-evaluates when the map changes.
   */
  public linksFor(taskId: string): readonly TaskLinkedSession[] {
    return this._links().get(taskId) ?? EMPTY_LINKS;
  }

  /**
   * Hold the service while a consumer is mounted; call the returned function
   * on destroy. The first consumer fetches unless this visit already did.
   */
  public retain(): () => void {
    this.consumers++;
    if (this.consumers === 1 && !this.fetchedThisVisit) this.startFetch();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.consumers = Math.max(0, this.consumers - 1);
      // Outside the Tasks surface there is no visit to scope the fetch to,
      // so the next mount counts as a new board load.
      if (this.consumers === 0 && !this.onTasksView) {
        this.fetchedThisVisit = false;
      }
    };
  }

  public handleMessage(message: { type: string; payload?: unknown }): void {
    if (!(this.handledMessageTypes as readonly string[]).includes(message.type))
      return;
    if (!this.isActive()) return;
    if (
      SESSION_TURN_PUSHES.has(message.type) &&
      !this.isLinkedSession(readSessionId(message.payload))
    ) {
      return;
    }
    void this.load();
  }

  private onContextChange(path: string | null, onTasksView: boolean): void {
    const switched = path !== this.lastWorkspacePath;
    const entered = onTasksView && !this.onTasksView;
    const left = !onTasksView && this.onTasksView;
    this.lastWorkspacePath = path;
    this.onTasksView = onTasksView;

    if (switched) this._links.set(EMPTY_MAP);
    if (left && this.consumers === 0) this.fetchedThisVisit = false;
    // A fetch already on the wire (cards mounted before this effect ran) is
    // this visit's fetch; do not issue a second one.
    if (entered && !this.inFlight) this.fetchedThisVisit = false;

    if ((entered && !this.fetchedThisVisit) || (switched && this.isActive())) {
      this.startFetch();
    }
  }

  /** The Tasks surface is open or a card is mounted: someone renders the map. */
  private isActive(): boolean {
    return this.onTasksView || this.consumers > 0;
  }

  private startFetch(): void {
    this.fetchedThisVisit = true;
    void this.load();
  }

  /** `null` (no session id in the payload) counts as linked: refetch to be safe. */
  private isLinkedSession(sessionId: string | null): boolean {
    if (sessionId === null) return true;
    for (const sessions of this._links().values()) {
      if (sessions.some((session) => session.sessionId === sessionId)) {
        return true;
      }
    }
    return false;
  }

  /** One fetch at a time; triggers during a fetch queue exactly one more. */
  private async load(): Promise<void> {
    if (this.inFlight) {
      this.reloadQueued = true;
      return;
    }
    this.inFlight = true;
    try {
      do {
        this.reloadQueued = false;
        await this.fetchOnce();
      } while (this.reloadQueued && this.isActive());
    } finally {
      this.inFlight = false;
      this.reloadQueued = false;
    }
  }

  private async fetchOnce(): Promise<void> {
    const workspacePath = this.appState.workspaceInfo()?.path;
    if (!workspacePath) {
      this._links.set(EMPTY_MAP);
      return;
    }

    let next: TaskSessionLinkMap = EMPTY_MAP;
    try {
      const result = await this.rpc.call('session:listForTasks', {
        workspacePath,
      });
      if (result.isSuccess()) {
        next = toLinkMap(result.data);
      } else {
        console.error(
          '[TaskSessionLinksService] session:listForTasks failed:',
          result.error,
        );
      }
    } catch (error: unknown) {
      console.error(
        '[TaskSessionLinksService] session:listForTasks threw:',
        error,
      );
    }

    // A workspace switch during the call queued its own fetch; this answer
    // belongs to the previous workspace and must not paint over it.
    if (this.appState.workspaceInfo()?.path !== workspacePath) return;
    this._links.set(next);
  }
}

function readSessionId(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const sessionId = payload['sessionId'];
  return typeof sessionId === 'string' && sessionId.length > 0
    ? sessionId
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate the host's answer into a map. Anything other than
 * `{ available: true, links: { [taskId]: TaskLinkedSession[] } }` is empty;
 * malformed entries are dropped one by one rather than failing the board.
 */
function toLinkMap(data: unknown): TaskSessionLinkMap {
  if (!isRecord(data) || data['available'] !== true) return EMPTY_MAP;
  const links = data['links'];
  if (!isRecord(links)) return EMPTY_MAP;

  const map = new Map<string, readonly TaskLinkedSession[]>();
  for (const [taskId, raw] of Object.entries(links)) {
    if (!Array.isArray(raw)) continue;
    const sessions = raw.filter(isLinkedSession).map(withValidPrLinks);
    if (sessions.length > 0) map.set(taskId, sessions);
  }
  return map;
}

function isLinkedSession(value: unknown): value is TaskLinkedSession {
  if (!isRecord(value)) return false;
  const phase = value['livePhase'];
  return (
    typeof value['sessionId'] === 'string' &&
    typeof value['name'] === 'string' &&
    (phase === null || (typeof phase === 'string' && TURN_PHASES.has(phase)))
  );
}

function withValidPrLinks(session: TaskLinkedSession): TaskLinkedSession {
  const prLinks: unknown = session.prLinks;
  return {
    ...session,
    prLinks: Array.isArray(prLinks)
      ? prLinks.filter(
          (link: unknown): link is SessionPrLinkSummary =>
            isRecord(link) && typeof link['url'] === 'string',
        )
      : [],
  };
}

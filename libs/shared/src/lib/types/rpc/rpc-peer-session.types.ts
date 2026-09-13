/**
 * Peer-session addressing wire contract (TASK_2026_402, Requirement 10).
 *
 * A "peer session" is another Claude Code process on this machine, discovered
 * from the CLI's own session registry (`~/.claude/sessions/<pid>.json`) — never
 * from Ptah-side bookkeeping. Ptah does not know about sessions it did not
 * start, and the registry is exactly the surface that does.
 *
 * ## The one rule this file exists to enforce
 *
 * **Nothing here says `delivered`, and nothing here may be read as saying it.**
 * `research-report-addressing.md` (Task 10.1) established that no route
 * available to Ptah can observe arrival:
 *
 *  - the SDK has no peer-send function and no message-shaped control request;
 *  - writing the registry's `messagingSocketPath` directly means reimplementing
 *    an undocumented private protocol, and is out of scope;
 *  - the one route that works is the model calling the CLI's own `SendMessage`
 *    tool, whose success value means "handed to the peer's inbox".
 *
 * So the strongest true statement is ACCEPTANCE, and {@link PeerSessionSendResult}
 * is shaped to make the weaker claim the only expressible one. A send that
 * reported success and never arrived is the exact defect TASK_2026_402 exists
 * to fix; `AgentReportRouter.deliver()` may legitimately use the stronger word
 * because it injects a turn into a session this process owns. This path has no
 * such privilege.
 */

// ---------------------------------------------------------------------------
// peerSession:list
// ---------------------------------------------------------------------------

/** Whether a listed session can be addressed at all. Two values, no maybe. */
export type PeerSessionReachability = 'reachable' | 'unreachable';

/**
 * Why a row is not reachable. Every value is a state a reader can act on.
 *
 * A row whose liveness could not be ESTABLISHED is `liveness-unverified` and
 * is unreachable — never reachable-by-default, and never omitted from the list
 * (Requirement 10, criterion 3).
 */
export type PeerSessionUnreachableReason =
  /** The pid in the record is not running. */
  | 'process-not-running'
  /**
   * The pid is running but its OS start time does not match the fingerprint
   * recorded at registration. Windows recycles pids; this is that case, and it
   * is the reason a bare pid-exists check is not acceptable here.
   */
  | 'process-identity-mismatch'
  /**
   * The liveness comparison could not be made — no `procStart` on the record,
   * an encoding this build cannot decode, or no start-time probe on this
   * platform. Unknown is reported as unreachable, deliberately.
   */
  | 'liveness-unverified'
  /** `pidDomain` names a different machine or platform than this host. */
  | 'other-host'
  /**
   * The record carries no `messagingSocketPath`, so the session has no peer
   * inbox. Written by CLI builds before the peer channel existed.
   */
  | 'no-messaging-channel'
  /** The registry file existed but did not parse as a session record. */
  | 'record-unreadable';

/** Where a row's display name came from, so a caller can weigh it. */
export type PeerSessionNameSource =
  /** The user chose it and it reached the registry (Batch 9's `--name`). */
  | 'user'
  /** The CLI derived it from the workspace. Recognisable, but not chosen. */
  | 'derived'
  /**
   * Ptah cannot vouch for this name: the record carried none (in which case
   * the row's `name` is a Ptah-synthesised placeholder built from the
   * workspace and pid), or it carried a `nameSource` this build does not
   * recognise. A caller should say so rather than present it as a name the
   * user chose.
   */
  | 'unknown';

/** One addressable — or explicitly not addressable — session. */
export interface PeerSessionRow {
  /** The CLI's own session UUID. The value `peerSession:send` takes. */
  readonly sessionId: string;
  /** Display name. Never empty; see {@link nameSource} before trusting it. */
  readonly name: string;
  readonly nameSource: PeerSessionNameSource;
  /** Absolute working directory the session was started in. */
  readonly workspace: string;
  /** Last path segment of {@link workspace}, for a compact row. */
  readonly workspaceLabel: string;
  /**
   * True when {@link workspace} is the host's current workspace root. Rows
   * from other workspaces are INCLUDED — see the note on
   * {@link PeerSessionListResult.crossWorkspacePolicy}.
   */
  readonly inCurrentWorkspace: boolean;
  readonly reachability: PeerSessionReachability;
  /** Set if and only if `reachability === 'unreachable'`. */
  readonly unreachableReason?: PeerSessionUnreachableReason;
  readonly pid: number;
  /** CLI version string from the record, when it carried one. */
  readonly cliVersion?: string;
  /** Epoch ms the record was written at registration. */
  readonly startedAt?: number;
}

/**
 * The cross-workspace decision, carried on every response so it is a stated
 * policy rather than an implementation detail a reader has to infer
 * (Requirement 10, criterion 5).
 */
export type PeerSessionCrossWorkspacePolicy = 'include-all-workspaces';

export interface PeerSessionListParams {
  /**
   * The caller's own session id, when it has one. The matching row is dropped
   * so a session is never offered itself as a peer.
   */
  readonly excludeSessionId?: string;
}

export interface PeerSessionListResult {
  readonly sessions: readonly PeerSessionRow[];
  /** The host's current workspace root, or null when it has none. */
  readonly currentWorkspace: string | null;
  /** Constant. Documented on {@link PeerSessionCrossWorkspacePolicy}. */
  readonly crossWorkspacePolicy: PeerSessionCrossWorkspacePolicy;
  /**
   * False when this platform has no start-time probe, so every row's liveness
   * is `liveness-unverified`. Lets a caller explain a wholly-unreachable list
   * instead of showing it as "nothing is running".
   */
  readonly livenessVerifiable: boolean;
}

// ---------------------------------------------------------------------------
// peerSession:send
// ---------------------------------------------------------------------------

/**
 * The transport Ptah uses. One value, and it is named on every response
 * because its two costs are not incidental: the send is performed by the model
 * calling the CLI's own peer-send tool, so it consumes a turn and the model
 * may phrase it differently or decline outright.
 */
export type PeerSessionSendRoute = 'model-mediated-cli-tool';

/**
 * What Ptah observed. `accepted` means the request was handed to the transport
 * — nothing more. There is deliberately no third value for "arrived", because
 * no route Ptah has can produce one.
 */
export type PeerSessionSendOutcome = 'accepted' | 'refused';

/** Why a send was refused. Every value is a state, not "something failed". */
export type PeerSessionSendRefusalReason =
  /** No registry row carries the requested session id. */
  | 'unknown-session'
  /** The row exists and is listed as unreachable. */
  | 'session-unreachable'
  /** The target is the sending session. */
  | 'self-addressed'
  /** The sending session id names no live session in this host. */
  | 'origin-session-not-active'
  /** No chat runtime is registered in this host to compose the turn into. */
  | 'chat-runtime-unavailable'
  /** Handing the composed request to the sending session threw. */
  | 'dispatch-failed';

/** The session a send was aimed at, echoed so a caller can render it. */
export interface PeerSessionTargetRef {
  readonly sessionId: string;
  readonly name: string;
  readonly workspace: string;
}

/**
 * The outcome of `peerSession:send`.
 *
 * Read {@link outcome} as "Ptah did / did not hand this to the transport". It
 * is NOT a statement about the peer. {@link acceptanceCaveat} says that in
 * words, and is intended to be shown, not logged and forgotten.
 */
export interface PeerSessionSendResult {
  readonly outcome: PeerSessionSendOutcome;
  readonly route: PeerSessionSendRoute;
  /**
   * A property of {@link route}, constant on every response including
   * refusals: an ACCEPTED send is performed by the model inside the sending
   * session, so it consumes a turn there. A refusal costs nothing, which is
   * exactly why the two are distinguishable.
   */
  readonly costsATurn: true;
  /**
   * A property of {@link route}, constant on every response: the model
   * performs the call, so it may word the message differently or decline
   * outright. Acceptance does not bind it.
   */
  readonly modelMayDecline: true;
  /**
   * Plain-language statement of what {@link outcome} does and does not mean.
   * Always present, on refusals too, so the limit travels with every response.
   */
  readonly acceptanceCaveat: string;
  readonly target?: PeerSessionTargetRef;
  /** Set if and only if `outcome === 'refused'`. */
  readonly reason?: PeerSessionSendRefusalReason;
  /** Human-readable elaboration of {@link reason}. */
  readonly detail?: string;
}

export interface PeerSessionSendParams {
  /** Registry session id of the peer, from `peerSession:list`. */
  readonly sessionId: string;
  /** The Ptah session the request is composed into. Pays the turn. */
  readonly fromSessionId: string;
  readonly message: string;
}

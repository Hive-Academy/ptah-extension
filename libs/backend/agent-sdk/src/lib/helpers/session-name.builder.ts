/**
 * Deliberate session naming.
 *
 * A Claude session that is not given a `--name` gets a DERIVED one, which is
 * what another agent sees in its session listing. A derived name is unstable
 * and unhelpful there, so every Ptah-started session composes its own.
 *
 * Two rules govern what this produces:
 *
 *  - **Uniqueness is guaranteed, not hoped for.** `uniqueSuffix` must be unique
 *    per LIVE PROCESS, not per tab. The routing id alone is not: a tab that is
 *    restarted keeps its id, so two CLI processes registered the same name
 *    (`ptah-ptah-extension-…-03497c`, pids 2368 and 17564, 2026-09-17) and a
 *    peer addressing that name could not know which process it reached. Use
 *    `buildUniqueSuffix` to compose the suffix — it keeps the routing-id head
 *    for legibility and appends a DERIVED allocation id (process id, host start
 *    instant, and a monotonic per-process counter) that carries the
 *    uniqueness. The CLI
 *    performs no duplicate check for a `-p` or SDK session, so nothing
 *    downstream would catch a collision, and a random nonce would leave one
 *    possible.
 *  - **The name is agent-facing text and names no vendor.** A Ptah CLI agent's
 *    user-chosen name is user DATA: it is slugified through here like any other
 *    input and is never enumerated in a description string.
 *
 * Failure is total and silent-free: the builder returns `undefined` rather than
 * throwing when the inputs sanitise to nothing, and the caller omits the key
 * and logs at `warn`. A naming problem must never cost a session.
 */

/** Upper bound on the composed name. */
const MAX_NAME_LENGTH = 64;

const NAME_PREFIX = 'ptah';

export interface SessionNameInput {
  /**
   * What the session is FOR — the user's own session name when they gave one,
   * else `chat` for the main session or the agent's configured name for a
   * spawn. Passed in raw: `slugify` below is the ONE sanitiser.
   */
  readonly role: string;
  /** Task this session serves, when it serves one. */
  readonly taskId?: string;
  /** Human-readable workspace label, usually the workspace folder name. */
  readonly workspaceLabel?: string;
  /** First characters of the session routing id / agent id. Carries the uniqueness. */
  readonly uniqueSuffix: string;
}

/**
 * Lower-case, collapse every character outside `[a-z0-9-]` into a single dash,
 * and trim the dashes off both ends.
 */
function slugify(value: string | undefined): string {
  if (!value) {
    return '';
  }
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Characters of the routing id kept as the legible head of the suffix. */
const ROUTING_ID_HEAD_LENGTH = 6;

/**
 * Base-36 width of the process id inside an allocation id.
 *
 * EXACT width, and that is what makes the encoding injective: the sequence
 * number that follows is variable length, so a variable-width pid would let
 * (pid 1, seq 23) and (pid 12, seq 3) both spell `123`. `padStart` supplies a
 * MINIMUM width, so the width is only exact while every pid fits inside it.
 * Seven base-36 characters hold 78_364_164_095, above the unsigned 32-bit
 * maximum 4_294_967_295 — which is the true Windows bound, and the reason six
 * is not enough (36^6 - 1 is 2_176_782_335, under it). Linux is the smaller
 * case: `pid_max` caps at 2^31 - 1.
 */
const PID_WIDTH = 7;

/**
 * Base of the host-start clock, `2020-01-01T00:00:00Z` in seconds.
 *
 * The stamp is an OFFSET from this instant, not a raw epoch, so it fits an
 * exact width for longer. Seconds, not milliseconds: the stamp separates two
 * host processes that held the same pid at different times, and a recycled pid
 * is never handed out inside the same second as its predecessor's exit.
 */
const HOST_START_EPOCH_SECONDS = 1_577_836_800;

/**
 * Base-36 width of the host-start stamp. Six characters hold 2_176_782_335
 * seconds, which runs from 2020 to 2088. Exact width for the same reason
 * `PID_WIDTH` is.
 */
const HOST_START_WIDTH = 6;

/** Minimum base-36 width of the per-process sequence number. */
const SEQUENCE_WIDTH = 2;

/**
 * Where the per-process counter lives.
 *
 * On `globalThis`, not in a module-scoped `let`. A module-scoped counter is one
 * counter PER LOADED COPY of this module, and a bundle can hold two copies —
 * the CJS and ESM builds of one lib, or two packaged versions — inside a single
 * process. Those copies would share a pid and a host-start stamp, run two
 * independent counters, and mint the same allocation id twice. The symbol is
 * registered, so every copy in the process resolves the same slot.
 */
const ALLOCATION_STATE_KEY = Symbol.for('ptah.agent-sdk.session-name.alloc');

interface AllocationState {
  sequence: number;
}

function allocationState(): AllocationState {
  const host = globalThis as unknown as Record<symbol, AllocationState>;
  return (host[ALLOCATION_STATE_KEY] ??= { sequence: 0 });
}

/**
 * The instant this host process started minting names, as an exact-width
 * base-36 offset from `HOST_START_EPOCH_SECONDS`. Read once.
 */
const hostStartStamp = Math.max(
  0,
  Math.floor(Date.now() / 1000) - HOST_START_EPOCH_SECONDS,
)
  .toString(36)
  .padStart(HOST_START_WIDTH, '0');

/**
 * Identity of one allocation:
 * `<pid base 36, 7 wide><host start base 36, 6 wide><sequence base 36>`.
 *
 * Uniqueness is DERIVED, not drawn. A random nonce cannot meet the criterion
 * this has to meet — it only makes a collision unlikely. Two live sessions are
 * separated by whichever of the three fields differs:
 *
 *  - Started by one host process, they hold different sequence numbers, because
 *    the counter only ever increases and every copy of this module in the
 *    process shares it.
 *  - Started by two host processes alive at the same time, they hold different
 *    pids, because an operating system never gives one pid to two live
 *    processes at once.
 *  - Started by two host processes alive at DIFFERENT times, they can share a
 *    recycled pid and a reset counter. The host-start stamp is what separates
 *    them, and it is the field that covers the case this task met in the field:
 *    a named CLI child outliving the host that spawned it.
 *
 * The one residue: two hosts that start inside the same second AND are handed
 * the same pid. An operating system does not recycle a pid to a process
 * starting in the same second its predecessor exited, so this needs the system
 * clock to be moved backwards between the two starts.
 */
function buildAllocationId(): string {
  const state = allocationState();
  const pid = process.pid.toString(36).padStart(PID_WIDTH, '0');
  const sequence = (state.sequence++)
    .toString(36)
    .padStart(SEQUENCE_WIDTH, '0');
  return `${pid}${hostStartStamp}${sequence}`;
}

/**
 * Compose the `uniqueSuffix` for one LIVE session process.
 *
 * `<first 6 of the routing id><allocation id>` — dash-free on purpose. A
 * consumer splits a registry name on its LAST dash to recover the role (see
 * `peer-session-picker.component.ts`), so a dash inside the suffix would move
 * that boundary and make every role read wrong.
 *
 * The routing-id head stays because it is what a person correlates a name with
 * in a log. It carries NO uniqueness of its own: the same tab restarted twice
 * produces the same head. `buildAllocationId` is the part that makes two live
 * processes distinguishable, and it is minted per call, so each spawn and each
 * resume gets its own.
 *
 * A blank routing id returns a blank suffix, which `buildSessionName` rejects.
 * That is deliberate and unchanged: a caller with no routing id is a caller
 * that has no session to name.
 */
export function buildUniqueSuffix(routingId: string | undefined): string {
  const head = slugify(routingId).slice(0, ROUTING_ID_HEAD_LENGTH);
  if (!head) {
    return '';
  }
  return `${head}${buildAllocationId()}`;
}

/**
 * The last path segment of a workspace folder, which is the label a person
 * recognises the project by. Accepts either separator so a Windows path and a
 * POSIX path reduce the same way, and tolerates a trailing separator.
 */
export function deriveWorkspaceLabel(
  workspacePath: string | undefined,
): string | undefined {
  if (!workspacePath) {
    return undefined;
  }
  const segments = workspacePath
    .split(/[\\/]+/)
    .filter((segment) => segment.length > 0);
  return segments[segments.length - 1];
}

/**
 * Compose `ptah-<workspaceLabel>-<role>[-<taskId>]-<uniqueSuffix>`.
 *
 * Returns `undefined` when the parts that make the name meaningful — the role
 * and the uniqueness suffix — sanitise to nothing. A name that is just the
 * prefix identifies no session and would collide with every other one.
 *
 * **THE REGISTRY NAME DOES NOT FOLLOW A RENAME.** What this composes is the
 * `--name` flag, which the CLI writes into `~/.claude/sessions/<pid>.json` as
 * `name` / `nameSource` when the process spawns. It is FIXED AT SPAWN: no
 * documented SDK or CLI API changes it afterwards, so a peer browsing the
 * session registry keeps reading the name this call produced for the life of
 * the process. Renaming a session in Ptah's UI changes the session TITLE
 * instead — a different surface, `Options.title` on a new session and the
 * SDK's `renameSession()` on an existing one (see `SessionTitleService`).
 * Do not write code, or a doc line, that claims a rename reaches here.
 */
export function buildSessionName(input: SessionNameInput): string | undefined {
  const role = slugify(input.role);
  const suffix = slugify(input.uniqueSuffix);
  if (!role || !suffix) {
    return undefined;
  }

  const head = [
    NAME_PREFIX,
    slugify(input.workspaceLabel),
    role,
    slugify(input.taskId),
  ]
    .filter((part) => part.length > 0)
    .join('-');

  // The cap truncates the HEAD only. The suffix is what makes the name unique,
  // so trimming the tail would trade a long name for a colliding one.
  const headBudget = MAX_NAME_LENGTH - suffix.length - 1;
  const truncatedHead = head
    .slice(0, Math.max(headBudget, 0))
    .replace(/-+$/g, '');

  return truncatedHead ? `${truncatedHead}-${suffix}` : suffix;
}

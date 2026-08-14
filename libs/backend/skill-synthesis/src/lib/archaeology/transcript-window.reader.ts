/**
 * TranscriptWindowReader — the retrieval engine the session archaeologist reads
 * a transcript through.
 *
 * WHY THIS EXISTS AT ALL (decision Q3). The archaeologist does NOT get an SDK
 * tool set. `OneShotRunInput` carries no `allowedTools` / `disallowedTools` and
 * `buildOneShotOptions` hardcodes the full `claude_code` preset, so the only
 * available choice would be handing an unattended background job every tool
 * including `Bash` and `Write`. Instead, TYPESCRIPT HOLDS THE READER AND THE
 * MODEL ASKS FOR RANGES: each pass replies with optional `requestTurns` /
 * `requestSearch` (`SessionVerdictDraft`), and this class serves exactly those
 * requests on the next pass. Retrieval is orchestrated, not tool-called.
 *
 * THREE PROPERTIES ARE THE WHOLE POINT:
 *
 *  1. PURE AND DETERMINISTIC. One read of the JSONL in `open()`; after that
 *     every accessor is a pure function of the loaded turns. No LLM, no clock,
 *     no randomness, no second I/O. That is what lets the multi-pass loop in
 *     `SessionArchaeologistService` be unit-tested without a model.
 *  2. TURN-INDEX ADDRESSED. Every window reports the turn indices it served.
 *     The verdict's `frictionMap[].turnIndex` and `routine.citations` cite those
 *     integers, so a citation is auditable — a later phase can go back and read
 *     turn 11. Indices are zero-based positions in the session's role-bearing,
 *     non-empty turns, which is the same numbering `ExtractedTrajectory.turnCount`
 *     counts. One numbering for the whole lib.
 *  3. `maxInputChars`-BOUNDED ON EVERY PATH. The lane declares the budget; a
 *     small-context endpoint must receive a TIGHTER SLICE, never a hard error.
 *     `window.text.length <= maxInputChars` is an invariant of every accessor,
 *     including the pathological cases below.
 *
 * WHICH END GETS TRUNCATED, AND WHY. Bounding is only useful if it is
 * predictable, so each accessor drops from the end furthest from its anchor and
 * says so in the window's `omittedTurnIndices`:
 *
 *  * `head(n)`  — anchored at turn 0; drops from the TAIL of the slice.
 *  * `tail(n)`  — anchored at the newest turn; drops from the HEAD of the slice.
 *                 Tail-first is the archaeologist's pass-1 shape (~40 % of the
 *                 budget of tail plus ~10 % of head), and this makes it exact.
 *  * `range(from,to)` — anchored at `from`, the turn the model NAMED; drops from
 *                 the TAIL. The dropped indices are reported, so the next pass
 *                 can ask for precisely the remainder. Truncating the other end
 *                 would discard the turn the model explicitly anchored on and
 *                 leave it no natural way to re-ask.
 *  * `search(probe)` — matches are served in ascending index order and dropped
 *                 from the TAIL of that list, so the served set is always a
 *                 stable prefix of the match list rather than an engine-order
 *                 sample.
 *
 * A turn is never dropped silently: the rendered text carries an
 * `OMITTED_TURNS_MARKER_PREFIX` line, and a single turn too large to fit on its
 * own is CHARACTER-truncated with `TRUNCATED_TURN_MARKER` rather than dropped —
 * an empty window would blind the analyst and burn a pass for nothing. On a
 * budget too small to carry both a turn and that marker, CONTENT WINS and the
 * marker is dropped instead; the omission is still on `omittedTurnIndices`,
 * which is the machine-readable half and the one a caller should branch on.
 *
 * THE SEARCH PROBE IS AN UNTRUSTED-INPUT BOUNDARY. `requestSearch` is model
 * output. A `string` probe is therefore matched as a case-insensitive LITERAL
 * substring — never compiled — which is both what `SESSION_VERDICT_JSON_SCHEMA`
 * promises ("Literal strings to search the transcript for") and linear-time by
 * construction, so no pattern can hang an unattended background job through
 * catastrophic backtracking. Trusted, in-repo probes can still pass a real
 * `RegExp`; the parameter TYPE is the trust boundary. A supplied `RegExp` is
 * rebuilt without `g`/`y` so a shared instance's `lastIndex` cannot make results
 * depend on call order — determinism again.
 *
 * NOT DI-REGISTERED, ON PURPOSE. An instance holds one session's turns, so a
 * container singleton would be a per-session cache shared across workspaces.
 * The archaeologist constructs one per session through `open()`.
 */

/** One role-bearing turn of a session, addressed by its zero-based index. */
export interface TranscriptTurn {
  readonly index: number;
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

/** A bounded, turn-index-addressed slice of a session, ready to serve to a model. */
export interface TranscriptWindow {
  /** Rendered, turn-labelled text. Never longer than {@link maxInputChars}. */
  readonly text: string;
  /** Indices actually served, ascending. */
  readonly turnIndices: readonly number[];
  /** Indices that were requested/matched but dropped for budget, ascending. */
  readonly omittedTurnIndices: readonly number[];
  /** The one turn whose TEXT was character-truncated to fit, or `null`. */
  readonly truncatedTurnIndex: number | null;
  /** `true` when anything was dropped or character-truncated. */
  readonly truncated: boolean;
  /** Turns the whole session has — the model's addressing space. */
  readonly totalTurns: number;
  /** The effective character budget this window was built against. */
  readonly maxInputChars: number;
}

/**
 * The one I/O seam. Structurally satisfied by `agent-sdk`'s `JsonlReaderService`
 * — declared locally rather than imported so this file stays a pure function of
 * its inputs and the spec can drive it with a two-method fake.
 */
export interface TranscriptJsonlReader {
  findSessionsDirectory(workspacePath: string): Promise<string | null>;
  readJsonlMessages(filePath: string): Promise<readonly unknown[]>;
}

/** Where a session's JSONL lives. Mirrors `TrajectoryExtractor.extract`'s resolution. */
export interface TranscriptSource {
  sessionId: string;
  workspaceRoot: string;
  /**
   * Read this exact file instead of resolving by session id. Required for
   * subagent transcripts, which live under `<parentSessionId>/subagents/`.
   */
  transcriptPath?: string;
}

/** Appended to the one turn whose text had to be cut to fit the budget. */
export const TRUNCATED_TURN_MARKER = '…';

/** Opens the marker line naming the turns a window had to drop. */
export const OMITTED_TURNS_MARKER_PREFIX = '[…';

/**
 * Longest accepted literal search probe. A longer one is rejected rather than
 * silently shortened, because a quietly-changed probe returns hits the caller
 * cannot explain.
 */
export const MAX_SEARCH_PROBE_CHARS = 200;

/** Blank line between rendered turns. */
const SEPARATOR = '\n\n';

/**
 * Room set aside for the omission marker whenever a window cannot serve
 * everything it was asked for. The marker's longest realistic form
 * (`[… 999999 turns omitted for budget: #999999–#999999 …]`) is ~55 chars.
 */
const OMITTED_TURNS_MARKER_RESERVE = 96;

/** Longest Bash command echoed into a turn's rendering. Matches `TrajectoryExtractor`. */
const BASH_COMMAND_CHARS = 80;

/**
 * Longest tool result echoed into a turn's rendering. Deliberately larger than
 * `TrajectoryExtractor`'s 200: that rendering is hashed and embedded, this one
 * is what the analyst actually READS, and a truncated failing-test output is
 * exactly the evidence the friction map is built from.
 */
const TOOL_RESULT_CHARS = 600;

export class TranscriptWindowReader {
  private constructor(
    private readonly turns: readonly TranscriptTurn[],
    /** The lane's declared ceiling. No accessor may exceed it. */
    readonly maxInputChars: number,
  ) {}

  /**
   * Read a session's JSONL once and return a reader over it.
   *
   * Throws when the transcript cannot be located or read — an unreadable
   * transcript is real information, and the archaeologist's caller turns it into
   * a `degradedReason` verdict rather than a retry storm. It is deliberately not
   * flattened into an empty session, which would be indistinguishable from a
   * session that genuinely has no turns.
   */
  static async open(
    reader: TranscriptJsonlReader,
    source: TranscriptSource,
    maxInputChars: number,
  ): Promise<TranscriptWindowReader> {
    let filePath: string;
    if (source.transcriptPath && source.transcriptPath.length > 0) {
      filePath = source.transcriptPath;
    } else {
      const sessionsDir = await reader.findSessionsDirectory(
        source.workspaceRoot,
      );
      if (!sessionsDir) {
        throw new Error(
          `[transcript-window] no sessions directory for workspace: ${source.workspaceRoot}`,
        );
      }
      filePath = `${sessionsDir}/${source.sessionId}.jsonl`;
    }
    const messages = await reader.readJsonlMessages(filePath);
    return TranscriptWindowReader.fromMessages(messages, maxInputChars);
  }

  /** Build from raw JSONL messages. Pure — the flattening half of {@link open}. */
  static fromMessages(
    messages: readonly unknown[],
    maxInputChars: number,
  ): TranscriptWindowReader {
    return TranscriptWindowReader.fromTurns(
      flattenTurns(messages),
      maxInputChars,
    );
  }

  /** Build from already-flattened turns. Turn indices are reassigned from 0. */
  static fromTurns(
    turns: readonly TranscriptTurn[],
    maxInputChars: number,
  ): TranscriptWindowReader {
    const renumbered = turns.map((t, index) => ({
      index,
      role: t.role,
      text: t.text,
    }));
    return new TranscriptWindowReader(
      renumbered,
      Math.max(0, Math.floor(maxInputChars)),
    );
  }

  /** Turns this session has. The model's whole addressing space. */
  get totalTurns(): number {
    return this.turns.length;
  }

  /**
   * The first `n` turns. Drops from the tail when over budget.
   *
   * @param n        Turns requested. Values below 1 yield an empty window;
   *                 values above {@link totalTurns} yield the whole session.
   * @param maxChars Optional tighter budget, clamped to {@link maxInputChars}.
   *                 Pass 1's head slice is `head(totalTurns, 0.1 * budget)`.
   */
  head(n: number, maxChars?: number): TranscriptWindow {
    const count = clampCount(n, this.turns.length);
    const order: number[] = [];
    for (let i = 0; i < count; i++) order.push(i);
    return this.build(order, false, maxChars);
  }

  /**
   * The last `n` turns. Drops from the HEAD when over budget, so the newest
   * turns always survive.
   *
   * @param maxChars Optional tighter budget, clamped to {@link maxInputChars}.
   *                 Pass 1's tail slice is `tail(totalTurns, 0.4 * budget)`.
   */
  tail(n: number, maxChars?: number): TranscriptWindow {
    const count = clampCount(n, this.turns.length);
    const order: number[] = [];
    for (let i = this.turns.length - 1; i >= this.turns.length - count; i--) {
      order.push(i);
    }
    return this.build(order, true, maxChars);
  }

  /**
   * An inclusive turn range, as named by the model's `requestTurns`.
   *
   * Model output, so every bound is sanitized: non-integers are floored, an
   * inverted `range(to, from)` is SWAPPED rather than rejected (the model
   * plainly meant that span, and rejecting would waste a pass), and bounds
   * outside the session are clamped. A range entirely outside the session
   * yields an empty window. Drops from the tail when over budget.
   */
  range(from: number, to: number, maxChars?: number): TranscriptWindow {
    const last = this.turns.length - 1;
    if (last < 0) return this.emptyWindow(maxChars);
    const a = toIndex(from);
    const b = toIndex(to);
    if (a === null || b === null) return this.emptyWindow(maxChars);
    let lo = Math.min(a, b);
    let hi = Math.max(a, b);
    if (hi < 0 || lo > last) return this.emptyWindow(maxChars);
    lo = Math.max(0, lo);
    hi = Math.min(last, hi);
    const order: number[] = [];
    for (let i = lo; i <= hi; i++) order.push(i);
    return this.build(order, false, maxChars);
  }

  /**
   * Every turn matching `probe`, ascending, dropped from the tail of the match
   * list when over budget.
   *
   * A `string` probe — the untrusted `requestSearch` case — is matched as a
   * case-insensitive LITERAL substring and is never compiled, which is what
   * bounds this call: literal matching is linear in the transcript, so no model
   * output can make an unattended job backtrack catastrophically. A blank probe,
   * or one longer than {@link MAX_SEARCH_PROBE_CHARS}, yields an empty window.
   *
   * A `RegExp` probe is trusted in-repo code. It is rebuilt without `g`/`y` so a
   * shared instance's `lastIndex` cannot make the result depend on call order.
   */
  search(probe: string | RegExp, maxChars?: number): TranscriptWindow {
    const matches = buildMatcher(probe);
    if (!matches) return this.emptyWindow(maxChars);
    const order = this.turns.filter((t) => matches(t.text)).map((t) => t.index);
    return this.build(order, false, maxChars);
  }

  /**
   * Greedily fill `order` — the accessor's preference order — against the
   * budget, then render the accepted turns in ascending index order.
   *
   * Filling stops at the FIRST turn that does not fit rather than skipping it
   * and trying smaller ones later, so the served set is always a prefix of
   * `order`: contiguous for `head` / `tail` / `range`, and a stable prefix of
   * the match list for `search`.
   */
  private build(
    order: readonly number[],
    markerAtStart: boolean,
    maxChars?: number,
  ): TranscriptWindow {
    const budget = this.effectiveBudget(maxChars);
    if (order.length === 0 || budget === 0) return this.emptyWindow(maxChars);

    const turns = order.map((i) => this.turns[i]);
    const fitsAll = totalCost(turns) <= budget;

    // Reserve room for the omission marker only when something will be dropped.
    let withMarker = !fitsAll;
    let fill = fillGreedily(
      turns,
      withMarker ? budget - OMITTED_TURNS_MARKER_RESERVE : budget,
    );
    if (fill.accepted === 0 && withMarker) {
      // The budget is too small to carry both a turn and the marker. Content
      // wins: the omission is still reported on `omittedTurnIndices`, and a
      // window that is nothing but a marker would tell the analyst nothing.
      withMarker = false;
      fill = fillGreedily(turns, budget);
    }

    const accepted = order.slice(0, fill.accepted);
    const truncatedTurnIndex =
      fill.truncatedOffset === null ? null : order[fill.truncatedOffset];
    const omitted = order.slice(fill.accepted);
    const ascending = [...accepted].sort((x, y) => x - y);
    const chunks = ascending.map(
      (index) => fill.rendered[accepted.indexOf(index)],
    );
    if (omitted.length > 0 && withMarker) {
      const marker = omittedMarker(omitted);
      if (markerAtStart) chunks.unshift(marker);
      else chunks.push(marker);
    }

    let text = chunks.join(SEPARATOR);
    // The invariant, enforced rather than assumed.
    if (text.length > budget) text = text.slice(0, budget);

    return {
      text,
      turnIndices: ascending,
      omittedTurnIndices: [...omitted].sort((x, y) => x - y),
      truncatedTurnIndex,
      truncated: omitted.length > 0 || truncatedTurnIndex !== null,
      totalTurns: this.turns.length,
      maxInputChars: budget,
    };
  }

  private effectiveBudget(maxChars?: number): number {
    if (maxChars === undefined || !Number.isFinite(maxChars)) {
      return this.maxInputChars;
    }
    return Math.max(0, Math.min(Math.floor(maxChars), this.maxInputChars));
  }

  private emptyWindow(maxChars?: number): TranscriptWindow {
    return {
      text: '',
      turnIndices: [],
      omittedTurnIndices: [],
      truncatedTurnIndex: null,
      truncated: false,
      totalTurns: this.turns.length,
      maxInputChars: this.effectiveBudget(maxChars),
    };
  }
}

interface GreedyFill {
  /** How many leading entries of the preference order were served. */
  accepted: number;
  /** Rendered text per accepted entry, in preference order. */
  rendered: string[];
  /** Offset into the preference order of the one character-truncated turn. */
  truncatedOffset: number | null;
}

/**
 * Serve `turns` in preference order until one does not fit.
 *
 * Stopping at the first turn that does not fit — rather than skipping it and
 * trying smaller ones behind it — is what keeps the served set a PREFIX of the
 * preference order, which is in turn what makes "dropped from the tail" /
 * "dropped from the head" a statement a caller can rely on.
 */
function fillGreedily(
  turns: readonly TranscriptTurn[],
  available: number,
): GreedyFill {
  const rendered: string[] = [];
  let truncatedOffset: number | null = null;
  let used = 0;

  for (let offset = 0; offset < turns.length; offset++) {
    const turn = turns[offset];
    const piece = renderTurn(turn);
    const cost = (rendered.length === 0 ? 0 : SEPARATOR.length) + piece.length;
    if (used + cost <= available) {
      rendered.push(piece);
      used += cost;
      continue;
    }
    if (rendered.length === 0) {
      // One turn larger than the whole budget. Serve it cut rather than handing
      // the analyst an empty window and burning a pass for nothing.
      const label = renderLabel(turn);
      const room = available - label.length - TRUNCATED_TURN_MARKER.length;
      if (room > 0) {
        truncatedOffset = offset;
        rendered.push(
          `${label}${turn.text.slice(0, room)}${TRUNCATED_TURN_MARKER}`,
        );
      }
    }
    break;
  }

  return { accepted: rendered.length, rendered, truncatedOffset };
}

/** `[#12 user]\n` — the label the model reads turn indices off. */
function renderLabel(turn: TranscriptTurn): string {
  return `[#${turn.index} ${turn.role}]\n`;
}

function renderTurn(turn: TranscriptTurn): string {
  return `${renderLabel(turn)}${turn.text}`;
}

function totalCost(turns: readonly TranscriptTurn[]): number {
  let cost = 0;
  for (let i = 0; i < turns.length; i++) {
    cost += renderTurn(turns[i]).length + (i === 0 ? 0 : SEPARATOR.length);
  }
  return cost;
}

function omittedMarker(omitted: readonly number[]): string {
  const lo = Math.min(...omitted);
  const hi = Math.max(...omitted);
  const noun = omitted.length === 1 ? 'turn' : 'turns';
  return `${OMITTED_TURNS_MARKER_PREFIX} ${omitted.length} ${noun} omitted for budget: #${lo}–#${hi} …]`;
}

function clampCount(n: number, total: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(Math.floor(n), total));
}

/** Model-supplied bound → a usable integer, or `null` when it is not a number. */
function toIndex(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  return Math.floor(value);
}

/**
 * A probe → a predicate, or `null` when the probe cannot be honoured. See
 * {@link TranscriptWindowReader.search} for why a string is never compiled.
 */
function buildMatcher(
  probe: string | RegExp,
): ((text: string) => boolean) | null {
  if (probe instanceof RegExp) {
    const stateless = new RegExp(
      probe.source,
      probe.flags.replace(/[gy]/g, ''),
    );
    return (text) => stateless.test(text);
  }
  const needle = probe.trim().toLowerCase();
  if (needle.length === 0 || needle.length > MAX_SEARCH_PROBE_CHARS)
    return null;
  return (text) => text.toLowerCase().includes(needle);
}

/**
 * Flatten raw JSONL messages into the turn numbering the whole lib shares:
 * role-bearing messages with non-empty rendered text, indexed from 0. Kept local
 * rather than shared with `TrajectoryExtractor` — this is the second occurrence
 * of the shape, not the third, and the two renderings answer to different
 * masters (that one is hashed, this one is read).
 */
function flattenTurns(messages: readonly unknown[]): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  for (const message of messages) {
    const role = roleOf(message);
    if (!role) continue;
    const text = textOf(message);
    if (!text) continue;
    turns.push({ index: turns.length, role, text });
  }
  return turns;
}

function roleOf(msg: unknown): 'user' | 'assistant' | null {
  if (!msg || typeof msg !== 'object') return null;
  const m = msg as { type?: string; message?: { role?: string } };
  const explicit = m.message?.role;
  if (explicit === 'user' || explicit === 'assistant') return explicit;
  if (m.type === 'user' || m.type === 'assistant') return m.type;
  return null;
}

function textOf(msg: unknown): string {
  if (!msg || typeof msg !== 'object') return '';
  const content = (msg as { message?: { content?: unknown } }).message?.content;
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const c of content) {
    if (!c || typeof c !== 'object') continue;
    const block = c as {
      type?: string;
      text?: string;
      name?: string;
      input?: unknown;
      content?: unknown;
    };
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    } else if (block.type === 'tool_use') {
      parts.push(toolUseMarker(block.name, block.input));
    } else if (block.type === 'tool_result') {
      const marker = toolResultMarker(block.content);
      if (marker) parts.push(marker);
    }
  }
  return parts.join('\n').trim();
}

function toolUseMarker(name: unknown, input: unknown): string {
  const toolName = typeof name === 'string' && name.length > 0 ? name : 'tool';
  if (toolName === 'Bash') {
    const cmd = bashCommandOf(input);
    if (cmd) return `[tool:Bash ${truncate(cmd, BASH_COMMAND_CHARS)}]`;
  }
  return `[tool:${toolName}]`;
}

function toolResultMarker(content: unknown): string {
  const compact = toolResultText(content).replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  return `[tool_result: ${truncate(compact, TOOL_RESULT_CHARS)}]`;
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const c of content) {
    if (!c || typeof c !== 'object') continue;
    const block = c as { type?: string; text?: string };
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    }
  }
  return parts.join(' ');
}

function bashCommandOf(input: unknown): string | null {
  if (input && typeof input === 'object' && 'command' in input) {
    const c = (input as { command?: unknown }).command;
    if (typeof c === 'string') return c;
  }
  return null;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}${TRUNCATED_TURN_MARKER}`;
}

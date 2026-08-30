import * as crypto from 'node:crypto';
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { SDK_TOKENS, type JsonlReaderService } from '@ptah-extension/agent-sdk';

/** Minimum number of user/assistant turns required to consider a session. */
export const MIN_TURNS_FOR_TRAJECTORY = 5;

/**
 * Absolute floor on role-bearing turns. Below this there is no trajectory to
 * extract at all — one turn is a message, not a session.
 *
 * It is also the DEFAULT for `extract`'s `minTurns`, which is the phase-2
 * split: the extractor answers "is there a readable session here", and
 * `SkillSynthesisService.passesPrefilter` answers "is it worth spending tokens
 * on". Those are different questions and were previously fused — badly, because
 * the fusion did not actually work (see `extract`).
 */
export const MIN_ROLE_TURNS_FLOOR = 2;

/**
 * Turns normalized+hashed between yields to the event loop.
 *
 * Extraction runs 90 s after every Stop, on the backend main thread — in
 * Electron the same loop that drives the windows (TASK_2026_323, B4). A long
 * session's normalization pass is regex work proportional to transcript size,
 * so it hands control back periodically. The threshold is high enough that
 * ordinary sessions (and every unit fixture) complete in one tick.
 */
const YIELD_EVERY_TURNS = 200;

/** Separator between turns in the canonical text. Also hashed, in order. */
const TURN_SEPARATOR = '\n---\n';

/** Hand back to the event loop, letting pending I/O run before we resume. */
function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

const EDIT_TOOL_NAMES = new Set(['Edit', 'Write', 'MultiEdit']);

/** Timestamp and epoch normalizations — compiled once, not per turn. */
const TIMESTAMP_PATTERN = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g;
const EPOCH_PATTERN = /\b\d{13}\b/g;
const REGEX_METACHARACTERS = /[.*+?^${}()|[\]\\]/g;
const BASH_TEST_PATTERN =
  /\b(npm|pnpm|yarn|jest|vitest|nx)\s+(test|run\s+test)\b/;

/**
 * Heuristic phrases interpreted as "task succeeded".
 *
 * ## THIS IS AN INFORMATIONAL SIGNAL AND NOTHING MAY DECIDE ON IT (phase 2)
 *
 * A model writing "Task complete!" is evidence that a model wrote a sentence.
 * The authority on whether a session succeeded is
 * `SessionVerdict.evidenceClass`, produced by the archaeologist from the whole
 * transcript — a session whose tail matches every regex below still comes back
 * `unverified` when nothing in the transcript settles the outcome.
 *
 * So the flag is still COMPUTED — it is a cheap, honest observation and phases
 * 3/4 may want it as one feature among many — but no promotion, eligibility,
 * ranking or synthesis path may read it to decide success. `regex-demotion.spec.ts`
 * pins that with a source scan; keep it true.
 */
const SUCCESS_MARKERS = [
  /\btask\s+complete(d)?\b/i,
  /\bdone[!.\s]/i,
  /\bsuccessfully\s+(completed|implemented|fixed|resolved)\b/i,
  /\ball\s+tests?\s+pass/i,
  /\b✅\b/,
  /\ball\s+\d*\s*(tests?|checks?)\s+pass(ing|ed)?\b/i,
  /\bimplementation\s+(is\s+)?complete\b/i,
  /\b(build|typecheck|lint)\s+(succeeded|passes|passing|green)\b/i,
];

export interface ExtractedTrajectory {
  /** Stable sha256 of the normalized turn sequence. */
  hash: string;
  /** Canonical text snapshot used for embedding/synthesis prompts. */
  canonicalText: string;
  /** Number of qualifying user+assistant turns used in the trajectory. */
  turnCount: number;
  /** Total number of turns in the raw session (before filtering). */
  sessionTurnCount: number;
  /** A short auto-generated description (first user turn, sliced). */
  shortDescription: string;
  /** A slug-friendly name derived from the description. */
  slug: string;
  /** Count of Edit/Write/MultiEdit tool_use blocks observed. */
  editCount: number;
  /** Count of all tool_use blocks observed. */
  toolUseCount: number;
  /** True when a test-runner Bash command completed in the session. */
  bashTestPassed: boolean;
  /** Length of the normalized canonical text. */
  charLength: number;
  /**
   * Informational signal — whether a success marker was found near the tail.
   *
   * INFORMATIONAL IN THE LITERAL SENSE: nothing may branch on it. The verdict's
   * `evidenceClass` is the authority on whether the session succeeded.
   */
  hasSuccessMarker: boolean;
}

@injectable()
export class TrajectoryExtractor {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_JSONL_READER)
    private readonly jsonlReader: JsonlReaderService,
  ) {}

  /**
   * Read the JSONL for a session and return its trajectory, or `null` when the
   * transcript cannot be read or carries fewer than `minTurns` role turns.
   *
   * A success marker is NEVER a condition — the doc comment that said so was
   * describing behaviour this class has not had for several releases, and
   * phase 2 makes the demotion explicit rather than accidental.
   *
   * ## `minTurns` IS HONOURED. IT USED TO BE `void`-ed.
   *
   * The parameter was neutered (`void minTurns;`) when the arithmetic curation
   * gates were replaced, leaving every caller setting a threshold that did
   * nothing while `MIN_ROLE_TURNS_FLOOR` silently decided. It now does what its
   * name says, and its DEFAULT moved from {@link MIN_TURNS_FOR_TRAJECTORY} to
   * {@link MIN_ROLE_TURNS_FLOOR} so that restoring it does not quietly NARROW
   * the harvest phase 2 is deliberately widening: a 3-turn session that lands an
   * edit is still extractable, and whether it is worth spending tokens on is
   * `passesPrefilter`'s call, not this method's.
   *
   * The value is clamped up to the floor — a caller asking for `0` is asking for
   * a trajectory over nothing.
   *
   * @param sessionId      Session to analyze.
   * @param workspaceRoot  Used to locate the JSONL file and normalize paths.
   * @param minTurns       Minimum role-bearing turns required. Defaults to
   *                       {@link MIN_ROLE_TURNS_FLOOR}, which is also the floor.
   * @param transcriptPath When provided, the JSONL at this exact path is read
   *                       instead of resolving the file by session id. Required
   *                       for subagent transcripts which live under
   *                       `<parentSessionId>/subagents/agent-<id>.jsonl`.
   */
  async extract(
    sessionId: string,
    workspaceRoot: string,
    minTurns: number = MIN_ROLE_TURNS_FLOOR,
    transcriptPath?: string,
  ): Promise<ExtractedTrajectory | null> {
    let filePath: string;
    if (transcriptPath && transcriptPath.length > 0) {
      filePath = transcriptPath;
    } else {
      const sessionsDir =
        await this.jsonlReader.findSessionsDirectory(workspaceRoot);
      if (!sessionsDir) {
        this.logger.debug('[skill-synthesis] no sessions dir for workspace', {
          workspaceRoot,
          sessionId,
        });
        return null;
      }
      filePath = `${sessionsDir}/${sessionId}.jsonl`;
    }
    let messages;
    try {
      messages = await this.jsonlReader.readJsonlMessages(filePath);
    } catch (err) {
      this.logger.warn('[skill-synthesis] could not read session JSONL', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
    const requiredTurns = Number.isFinite(minTurns)
      ? Math.max(MIN_ROLE_TURNS_FLOOR, Math.floor(minTurns))
      : MIN_ROLE_TURNS_FLOOR;
    let sessionTurnCount = 0;
    let editCount = 0;
    let toolUseCount = 0;
    let bashTestPassed = false;
    const turns: Array<{ role: 'user' | 'assistant'; text: string }> = [];
    for (const m of messages) {
      const role = this.roleOf(m);
      if (role) sessionTurnCount++;
      if (!role) continue;
      const signals = this.collectToolSignals(m);
      editCount += signals.editCount;
      toolUseCount += signals.toolUseCount;
      if (signals.bashTestPassed) bashTestPassed = true;
      const text = this.textOf(m);
      if (!text) continue;
      turns.push({ role, text });
    }

    if (turns.length < requiredTurns) {
      return null;
    }

    // Computed, carried, and read by NOBODY as a success decision. See the
    // SUCCESS_MARKERS header.
    const hasSuccessMarker = this.hasSuccessMarker(turns);

    // ONE pass normalizes, hashes and collects. It used to be three
    // traversals of the whole transcript — `map(normalize)`, then `join`,
    // then `createHash().update()` over the joined megabytes — with a fresh
    // `new RegExp(workspaceRoot, 'gi')` COMPILED INSIDE `normalize`, so the
    // regex was rebuilt once per turn (TASK_2026_323, B4). The hash is
    // identical to the old one by construction: the same bytes, in the same
    // order, fed through `update` in pieces instead of all at once.
    const workspacePattern = this.compileWorkspacePattern(workspaceRoot);
    const hasher = crypto.createHash('sha256');
    const parts: string[] = [];
    for (let i = 0; i < turns.length; i++) {
      if (i > 0) hasher.update(TURN_SEPARATOR);
      const t = turns[i];
      const part = `[${t.role}] ${this.normalize(t.text, workspacePattern)}`;
      hasher.update(part);
      parts.push(part);
      if ((i + 1) % YIELD_EVERY_TURNS === 0) {
        await yieldToEventLoop();
      }
    }
    const normalized = parts.join(TURN_SEPARATOR);
    const hash = hasher.digest('hex');

    const firstUser = turns.find((t) => t.role === 'user')?.text ?? '';
    const shortDescription = this.truncate(firstUser.replace(/\s+/g, ' '), 140);
    const slug = this.slugify(shortDescription);

    return {
      hash,
      canonicalText: normalized,
      turnCount: turns.length,
      sessionTurnCount: sessionTurnCount > 0 ? sessionTurnCount : turns.length,
      shortDescription: shortDescription || 'Captured workflow',
      slug: slug || `skill-${hash.slice(0, 8)}`,
      editCount,
      toolUseCount,
      bashTestPassed,
      charLength: normalized.length,
      hasSuccessMarker,
    };
  }

  private roleOf(msg: unknown): 'user' | 'assistant' | null {
    if (!msg || typeof msg !== 'object') return null;
    const m = msg as { type?: string; message?: { role?: string } };
    const explicit = m.message?.role;
    if (explicit === 'user' || explicit === 'assistant') return explicit;
    if (m.type === 'user' || m.type === 'assistant') return m.type;
    return null;
  }

  private textOf(msg: unknown): string {
    if (!msg || typeof msg !== 'object') return '';
    const m = msg as { message?: { content?: unknown } };
    const content = m.message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
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
          parts.push(this.toolUseMarker(block.name, block.input));
        } else if (block.type === 'tool_result') {
          const marker = this.toolResultMarker(block.content);
          if (marker) parts.push(marker);
        }
      }
      return parts.join('\n');
    }
    return '';
  }

  private toolUseMarker(name: unknown, input: unknown): string {
    const toolName =
      typeof name === 'string' && name.length > 0 ? name : 'tool';
    if (toolName === 'Bash') {
      const cmd = this.bashCommandOf(input);
      if (cmd) return `[tool:Bash ${this.truncate(cmd, 80)}]`;
    }
    return `[tool:${toolName}]`;
  }

  private toolResultMarker(content: unknown): string {
    const text = this.toolResultText(content);
    if (!text) return '';
    const compact = text.replace(/\s+/g, ' ').trim();
    if (!compact) return '';
    return `[tool_result: ${this.truncate(compact, 200)}]`;
  }

  private toolResultText(content: unknown): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      const parts: string[] = [];
      for (const c of content) {
        if (c && typeof c === 'object') {
          const block = c as { type?: string; text?: string };
          if (block.type === 'text' && typeof block.text === 'string') {
            parts.push(block.text);
          }
        }
      }
      return parts.join(' ');
    }
    return '';
  }

  private bashCommandOf(input: unknown): string | null {
    if (input && typeof input === 'object' && 'command' in input) {
      const c = (input as { command?: unknown }).command;
      if (typeof c === 'string') return c;
    }
    return null;
  }

  private collectToolSignals(msg: unknown): {
    editCount: number;
    toolUseCount: number;
    bashTestPassed: boolean;
  } {
    let editCount = 0;
    let toolUseCount = 0;
    let bashTestPassed = false;
    if (!msg || typeof msg !== 'object') {
      return { editCount, toolUseCount, bashTestPassed };
    }
    const m = msg as { message?: { content?: unknown } };
    const content = m.message?.content;
    if (!Array.isArray(content)) {
      return { editCount, toolUseCount, bashTestPassed };
    }
    for (const c of content) {
      if (!c || typeof c !== 'object') continue;
      const block = c as { type?: string; name?: string; input?: unknown };
      if (block.type !== 'tool_use') continue;
      toolUseCount++;
      const toolName = typeof block.name === 'string' ? block.name : '';
      if (EDIT_TOOL_NAMES.has(toolName)) {
        editCount++;
      } else if (toolName === 'Bash') {
        const cmd = this.bashCommandOf(block.input);
        if (cmd && BASH_TEST_PATTERN.test(cmd)) bashTestPassed = true;
      }
    }
    return { editCount, toolUseCount, bashTestPassed };
  }

  private hasSuccessMarker(
    turns: ReadonlyArray<{ role: 'user' | 'assistant'; text: string }>,
  ): boolean {
    const tailStart = Math.max(0, Math.floor(turns.length * 0.75));
    for (let i = tailStart; i < turns.length; i++) {
      const t = turns[i];
      if (t.role !== 'assistant') continue;
      for (const re of SUCCESS_MARKERS) {
        if (re.test(t.text)) return true;
      }
    }
    return false;
  }

  /**
   * Build the workspace-root matcher ONCE per extraction.
   *
   * `new RegExp` compiles a pattern; doing it per turn made the compile cost
   * scale with transcript length for a pattern that never varies within a
   * single `extract` call. Returns `null` when there is no root to redact.
   */
  private compileWorkspacePattern(workspaceRoot: string): RegExp | null {
    if (!workspaceRoot) return null;
    const escaped = workspaceRoot.replace(REGEX_METACHARACTERS, '\\$&');
    return new RegExp(escaped, 'gi');
  }

  private normalize(text: string, workspacePattern: RegExp | null): string {
    let out = text;
    if (workspacePattern) {
      // Shared `g` regexes carry `lastIndex`; `String.replace` with a global
      // pattern resets it to 0 on entry and exit, so reuse across turns is
      // safe here in a way that `test`/`exec` would not be.
      out = out.replace(workspacePattern, '<WORKSPACE>');
    }
    out = out.replace(TIMESTAMP_PATTERN, '<TS>');
    out = out.replace(EPOCH_PATTERN, '<EPOCH>');
    return out.trim();
  }

  private truncate(s: string, max: number): string {
    return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
  }

  private slugify(s: string): string {
    return s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
  }
}

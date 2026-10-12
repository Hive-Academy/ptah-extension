import type { StreamingState } from '@ptah-extension/chat-types';

/**
 * Bounded memos for the per-item text work of a live compact summary rebuild.
 * Each is keyed by an id that is unique across tabs (a message's block, a
 * tool call), keeps the exact input it was computed from, and is reused only
 * when that input is identical, so a stale entry is never returned.
 *
 * Retention is bounded three ways, so text from closed sessions cannot pile
 * up: an input longer than `MEMO_MAX_ENTRY_CHARS` is never cached, and the
 * least recently used entries are dropped while a memo holds more than
 * `MEMO_MAX_ENTRIES` entries or more than `MEMO_MAX_RETAINED_CHARS` characters.
 * There are no timers.
 */
const MEMO_MAX_ENTRIES = 256;
const MEMO_MAX_ENTRY_CHARS = 32_768;
const MEMO_MAX_RETAINED_CHARS = 1_048_576;

interface MemoEntry<T> {
  readonly value: T;
  /** Characters this entry keeps alive (input plus result). */
  readonly size: number;
}

interface Memo<T> {
  readonly entries: Map<string, MemoEntry<T>>;
  retained: number;
}

interface RedactedBlock {
  readonly raw: string;
  readonly workspacePath: string;
  readonly redacted: string;
}

interface ParsedToolInput {
  readonly raw: string;
  readonly parsed: Readonly<Record<string, unknown>> | null;
}

const redactedBlocks: Memo<RedactedBlock> = { entries: new Map(), retained: 0 };
const parsedToolInputs: Memo<ParsedToolInput> = {
  entries: new Map(),
  retained: 0,
};

/** Reads an entry and marks it most recently used. */
function recall<T>(memo: Memo<T>, key: string): T | undefined {
  const entry = memo.entries.get(key);
  if (entry === undefined) return undefined;
  memo.entries.delete(key);
  memo.entries.set(key, entry);
  return entry.value;
}

function forget<T>(memo: Memo<T>, key: string): void {
  const entry = memo.entries.get(key);
  if (entry === undefined) return;
  memo.entries.delete(key);
  memo.retained -= entry.size;
}

/**
 * Stores a result for `key`, replacing any older one. An input over the
 * per-entry cap only drops the older entry: its result is not kept.
 */
function remember<T>(
  memo: Memo<T>,
  key: string,
  value: T,
  inputLength: number,
  size: number,
): void {
  forget(memo, key);
  if (inputLength > MEMO_MAX_ENTRY_CHARS) return;
  memo.entries.set(key, { value, size });
  memo.retained += size;
  while (
    memo.entries.size > MEMO_MAX_ENTRIES ||
    memo.retained > MEMO_MAX_RETAINED_CHARS
  ) {
    const oldest = memo.entries.keys().next();
    if (oldest.done) break;
    forget(memo, oldest.value);
  }
}

/**
 * A prose block's text, path-redacted. The whole block is redacted again
 * whenever its text changed, never only the new suffix: a path split across
 * two deltas would otherwise keep its unredacted prefix.
 */
export function redactBlock(
  blockId: string,
  raw: string,
  workspacePath: string,
): string {
  const cached = recall(redactedBlocks, blockId);
  if (cached && cached.raw === raw && cached.workspacePath === workspacePath) {
    return cached.redacted;
  }
  const redacted = redactAbsolutePaths(raw, workspacePath);
  remember(
    redactedBlocks,
    blockId,
    { raw, workspacePath, redacted },
    raw.length,
    raw.length + redacted.length,
  );
  return redacted;
}

/**
 * A call's input. A stream-source `tool_start` carries none; the input then
 * streams into `toolInputAccumulators`, and is used once it parses.
 */
export function toolInputOf(
  state: StreamingState,
  toolCallId: string,
  input: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> | undefined {
  if (input && Object.keys(input).length > 0) return input;
  const raw = state.toolInputAccumulators.get(`${toolCallId}-input`);
  if (!raw) return input;
  return parseToolInput(toolCallId, raw) ?? input;
}

/** A streamed tool input as an object; `null` until it parses as one. */
function parseToolInput(
  toolCallId: string,
  raw: string,
): Readonly<Record<string, unknown>> | null {
  const cached = recall(parsedToolInputs, toolCallId);
  if (cached && cached.raw === raw) return cached.parsed;
  let parsed: Readonly<Record<string, unknown>> | null = null;
  try {
    const value: unknown = JSON.parse(raw);
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      parsed = value as Record<string, unknown>;
    }
  } catch {
    // degradation-audit: optional-capability - input that is still streaming
    // (partial JSON) only costs the row its target until a later rebuild;
    // the row shows the tool name meanwhile.
  }
  // The parsed object holds roughly the raw text again, so count it twice.
  remember(
    parsedToolInputs,
    toolCallId,
    { raw, parsed },
    raw.length,
    raw.length * 2,
  );
  return parsed;
}

/**
 * Replaces the workspace path with its folder name and cuts other absolute
 * Windows and home paths down to their last segment.
 */
export function redactAbsolutePaths(
  value: string,
  workspacePath: string,
): string {
  const workspace = workspacePath.replace(/\\/g, '/').replace(/\/$/, '');
  let result = value;
  if (workspace) {
    result = result.replaceAll(workspacePath, workspaceLabel(workspacePath));
    result = result.replaceAll(workspace, workspaceLabel(workspace));
  }
  return result
    .replace(/\b[A-Za-z]:[\\/](?:[^\s\\/"'`]+[\\/])*([^\s\\/"'`]+)/g, '$1')
    .replace(/\/(?:Users|home)\/[^\s/]+\/(?:[^\s/"'`]+\/)*([^\s/"'`]+)/g, '$1');
}

function workspaceLabel(path: string): string {
  return (
    path
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() ?? path
  );
}

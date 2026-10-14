/**
 * SubagentHandoffRecords — the durable copy of a subagent handoff.
 *
 * When the `SubagentBudgetMonitor` stops a subagent, the handoff text is
 * first written to one record file under
 * `<session workspace>/.ptah/subagent-handoffs/`, named
 * `<time>-<owner16>-<tool>-<nonce8>.handoff.md`:
 *
 * - `time`: the write time, `yyyyMMddTHHmmssSSSZ` (names sort oldest first).
 * - `owner16`: {@link ownerHash} of the session id at the stop. Who a record
 *   belongs to comes from this immutable name, never from the file content.
 * - `tool`: the spawning tool-use id reduced to `[A-Za-z0-9_-]`, at most 64.
 * - `nonce8`: four random bytes in hex.
 *
 * The file is created exclusively (`wx`) and written once; the host never
 * rewrites it. Its frontmatter carries only `status`: `pending` when written;
 * the agent that reads it sets `consumed` or `dismissed`.
 *
 * One record per tool-use id: concurrent stops of one subagent (two session
 * records not yet merged by a rekey) share the first write. Once the stop was
 * invoked with a record ({@link SubagentHandoffRecords.markInvoked}), the host
 * never deletes it; before that, {@link SubagentHandoffRecords.withdraw}
 * removes a record whose stop will not run.
 *
 * Trust boundary: the workspace filesystem is trusted local state, as for the
 * other `.ptah/subagent-handoffs` files. Before a write, `.ptah` and the
 * handoff directory must be real directories (no link or junction) whose real
 * path is inside the workspace. A task-folder stub
 * ({@link SubagentHandoffRecords.writeStub}) goes only into a real, direct
 * child of `<workspace>/.ptah/specs`.
 *
 * Never throws. Logs carry ids, `errorType` and `errorCode`, never handoff
 * or prompt text.
 */
import { createHash, randomBytes } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  SUBAGENT_HANDOFF_DIR,
  withinHandoffTimeout,
} from './subagent-handoff-files';

/** File name suffix of a handoff record. */
export const HANDOFF_RECORD_SUFFIX = '.handoff.md';
/** Bytes of a record read to parse its frontmatter. */
export const HANDOFF_RECORD_HEAD_BYTES = 2_048;
/** Longest `tool` part of a record name. */
const MAX_TOOL_NAME_CHARS = 64;

const RECORD_NAME =
  /^(\d{8}T\d{9}Z)-([0-9a-f]{16})-([A-Za-z0-9_-]{1,64})-([0-9a-f]{8})\.handoff\.md$/;
const HEAD_LINE = /^([A-Za-z0-9_-]+):[ \t]*(.*?)[ \t]*$/;
const KNOWN_STATUSES: ReadonlySet<string> = new Set([
  'pending',
  'consumed',
  'dismissed',
]);

/** The parts of a record file name. */
export interface HandoffRecordName {
  readonly time: string;
  readonly owner: string;
  readonly tool: string;
  readonly nonce: string;
}

/** A record's frontmatter status; `malformed` is treated as pending. */
export type HandoffRecordStatus =
  'pending' | 'consumed' | 'dismissed' | 'malformed';

/** The outcome of {@link SubagentHandoffRecords.writeOnce}. */
export type HandoffRecordWrite =
  | {
      readonly ok: true;
      /** Absolute record path. */
      readonly path: string;
      /** The workspace the record was written under. */
      readonly workspace: string;
      /** The record file name. */
      readonly name: string;
    }
  | {
      readonly ok: false;
      readonly errorType: string;
      readonly errorCode?: string;
    };

/** Where the handoff directory of a workspace stands. */
export type HandoffDirCheck =
  | { readonly ok: true; readonly dir: string }
  | { readonly ok: false; readonly reason: 'missing' | 'refused' };

/** First 16 lowercase hex characters of the SHA-256 of `sessionId`. */
export function ownerHash(sessionId: string): string {
  return createHash('sha256')
    .update(sessionId, 'utf8')
    .digest('hex')
    .slice(0, 16);
}

/** The `tool` part of a record name, or `undefined` when nothing usable remains. */
function toolPart(toolCallId: string): string | undefined {
  const name = toolCallId
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .slice(0, MAX_TOOL_NAME_CHARS);
  return /[A-Za-z0-9]/.test(name) ? name : undefined;
}

/** The record file name, or `undefined` for a tool-use id with no usable characters. */
export function recordFileName(
  now: number,
  sessionId: string,
  toolCallId: string,
  nonce: string,
): string | undefined {
  const tool = toolPart(toolCallId);
  if (!tool) {
    return undefined;
  }
  const time = new Date(now).toISOString().replace(/[-:.]/g, '');
  return `${time}-${ownerHash(sessionId)}-${tool}-${nonce}${HANDOFF_RECORD_SUFFIX}`;
}

/** The parts of a record file name; `undefined` for any other name. */
export function parseRecordName(name: string): HandoffRecordName | undefined {
  const match = RECORD_NAME.exec(name);
  return match
    ? { time: match[1], owner: match[2], tool: match[3], nonce: match[4] }
    : undefined;
}

/** The content of a new record: pending frontmatter, a dismiss rule, the handoff. */
export function renderRecord(text: string): string {
  return (
    '---\nstatus: pending\n---\n' +
    'Ptah subagent handoff record. If its subagent is still running or ' +
    'finished normally, set `status: dismissed`.\n\n' +
    `${text}\n`
  );
}

/**
 * The status in a record's first {@link HANDOFF_RECORD_HEAD_BYTES} bytes.
 * The head must open with a `---` line and close with another; every line
 * between is `key: value`, and `status` appears exactly once with a known
 * value. Anything else is `malformed`.
 */
export function parseRecordHead(head: string): HandoffRecordStatus {
  const open = head.startsWith('---\n')
    ? 4
    : head.startsWith('---\r\n')
      ? 5
      : -1;
  if (open < 0) {
    return 'malformed';
  }
  let status: string | undefined;
  let statusCount = 0;
  for (const line of head.slice(open).split(/\r?\n/)) {
    if (line === '---') {
      return statusCount === 1 && isKnownStatus(status) ? status : 'malformed';
    }
    const field = HEAD_LINE.exec(line);
    if (!field) {
      return 'malformed';
    }
    if (field[1] === 'status') {
      statusCount += 1;
      status = field[2];
    }
  }
  // No closing fence inside the head.
  return 'malformed';
}

function isKnownStatus(
  value: string | undefined,
): value is Exclude<HandoffRecordStatus, 'malformed'> {
  return value !== undefined && KNOWN_STATUSES.has(value);
}

/** The `**Task Folder**` value a spawning prompt names, if any. */
export function taskFolderOf(prompt: string): string | undefined {
  const match = /^[ \t>*-]*\*\*Task Folder:?\*\*:?[ \t]*(.+?)[ \t]*$/im.exec(
    prompt,
  );
  const folder = match?.[1].replace(/^[`'"]+|[`'"]+$/g, '').trim();
  return folder || undefined;
}

function errorDetails(error: unknown): {
  errorType: string;
  errorCode?: string;
} {
  const code = (error as { code?: unknown } | null)?.code;
  return {
    errorType: error instanceof Error ? error.name : typeof error,
    ...(typeof code === 'string' ? { errorCode: code } : {}),
  };
}

function errorCodeOf(error: unknown): string | undefined {
  return errorDetails(error).errorCode;
}

/** Path comparison as the platform's filesystem compares them. */
function samePath(a: string, b: string): boolean {
  return process.platform === 'win32'
    ? path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase()
    : path.normalize(a) === path.normalize(b);
}

/** `child` is strictly inside `parent`. */
function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return (
    rel !== '' &&
    rel !== '..' &&
    !rel.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(rel)
  );
}

/** Each path is a real directory, not a link or junction; rejects when one is missing. */
async function realDirectories(paths: readonly string[]): Promise<boolean> {
  for (const candidate of paths) {
    const stat = await fs.lstat(candidate);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      return false;
    }
  }
  return true;
}

/**
 * The handoff directory of `workspace` when `.ptah` and the directory are
 * real directories whose real path is inside the workspace's. With `create`
 * each missing level is created (one level at a time, after its parent passed
 * the check, so nothing is created through a link); without it a missing one
 * is `missing`. Rejects on other I/O errors.
 */
export async function checkHandoffDir(
  workspace: string,
  create: boolean,
): Promise<HandoffDirCheck> {
  const dir = path.join(workspace, SUBAGENT_HANDOFF_DIR);
  for (const level of [path.join(workspace, '.ptah'), dir]) {
    let stat = await lstatIfPresent(level);
    if (!stat) {
      if (!create) {
        return { ok: false, reason: 'missing' };
      }
      await fs.mkdir(level).catch((error: unknown) => {
        if (errorCodeOf(error) !== 'EEXIST') {
          throw error;
        }
      });
      stat = await fs.lstat(level);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      return { ok: false, reason: 'refused' };
    }
  }
  const [realWorkspace, realDir] = await Promise.all([
    fs.realpath(workspace),
    fs.realpath(dir),
  ]);
  const inside =
    process.platform === 'win32'
      ? isInside(realWorkspace.toLowerCase(), realDir.toLowerCase())
      : isInside(realWorkspace, realDir);
  return inside ? { ok: true, dir } : { ok: false, reason: 'refused' };
}

/** `lstat` of `target`, `undefined` when it does not exist. */
async function lstatIfPresent(
  target: string,
): Promise<Awaited<ReturnType<typeof fs.lstat>> | undefined> {
  try {
    return await fs.lstat(target);
  } catch (error: unknown) {
    if (errorCodeOf(error) === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

/** One record write per spawning tool-use id. */
interface RecordWriter {
  /** The session id the record was written for (its owner). */
  readonly sessionId: string;
  readonly write: Promise<HandoffRecordWrite>;
  /** The record path once the write succeeded. */
  path?: string;
  /** `stopSubagent` was called with this record: never delete it. */
  invoked: boolean;
}

export class SubagentHandoffRecords {
  /** Writers by spawning tool-use id (S5: SDK tool-use ids are unique across sessions). */
  private readonly writers = new Map<string, RecordWriter>();

  constructor(
    private readonly logger: Logger,
    /** The workspace root of a session, `undefined` when unknown. */
    readonly workspaceOf: (sessionId: string) => string | undefined,
    private readonly now: () => number = Date.now,
    private readonly nonce: () => string = () => randomBytes(4).toString('hex'),
  ) {}

  /**
   * Write the record for `toolCallId` once. A second call while the first is
   * kept (in flight, or written and not withdrawn) returns the same write.
   * A failure (no workspace, guard refusal, write error, `EEXIST`, or the
   * {@link withinHandoffTimeout} bound) frees the slot for a later retry; a
   * write that completes after the timeout is unlinked. Never rejects.
   */
  writeOnce(
    sessionId: string,
    toolCallId: string,
    text: string,
  ): Promise<HandoffRecordWrite> {
    const existing = this.writers.get(toolCallId);
    if (existing) {
      return existing.write;
    }
    const writer: RecordWriter = {
      sessionId,
      write: this.write(sessionId, toolCallId, text),
      invoked: false,
    };
    this.writers.set(toolCallId, writer);
    void writer.write.then((result) => {
      if (result.ok) {
        writer.path = result.path;
      } else if (this.writers.get(toolCallId) === writer) {
        this.writers.delete(toolCallId);
      }
    });
    return writer.write;
  }

  /** `stopSubagent` is about to be called with this subagent's record: keep it for good. */
  markInvoked(toolCallId: string): void {
    const writer = this.writers.get(toolCallId);
    if (writer) {
      writer.invoked = true;
    }
  }

  /**
   * The stop of `toolCallId` will not run (released session, or another stop
   * finished first): delete its record at `recordPath`, unless a stop was
   * already invoked with it. Never rejects.
   */
  async withdraw(toolCallId: string, recordPath: string): Promise<void> {
    const writer = this.writers.get(toolCallId);
    if (!writer || writer.invoked || writer.path !== recordPath) {
      return;
    }
    this.writers.delete(toolCallId);
    try {
      await fs.unlink(recordPath);
      this.logger.debug('[SubagentHandoffRecords] Handoff record withdrawn', {
        toolCallId,
      });
    } catch (error: unknown) {
      this.logger.warn(
        '[SubagentHandoffRecords] Handoff record not withdrawn',
        { toolCallId, ...errorDetails(error) },
      );
    }
  }

  /**
   * Session end: drop the writers of these session ids whose stop was
   * invoked. A writer not invoked yet still has its stop in flight, which
   * invokes or withdraws it.
   */
  forget(sessionIds: ReadonlySet<string>): void {
    for (const [toolCallId, writer] of this.writers) {
      if (writer.invoked && sessionIds.has(writer.sessionId)) {
        this.writers.delete(toolCallId);
      }
    }
  }

  /**
   * Best effort: leave a stub naming `recordPath` in the task folder the
   * spawning `prompt` names (`**Task Folder**`), when that folder is a real,
   * direct child of `<workspace>/.ptah/specs`. Bounded by
   * {@link withinHandoffTimeout}; a failure is one debug line. Never rejects.
   */
  async writeStub(
    prompt: string,
    agentType: string,
    recordPath: string,
  ): Promise<void> {
    const folder = taskFolderOf(prompt);
    const parts = parseRecordName(path.basename(recordPath));
    if (!folder || !parts) {
      return;
    }
    const workspace = path.resolve(path.dirname(recordPath), '..', '..');
    const type = toolPart(agentType) ?? 'subagent';
    const result = await withinHandoffTimeout(
      this.createStub(
        workspace,
        folder,
        `subagent-handoff-${type}-${parts.nonce}.md`,
        recordPath,
      ),
    );
    if (result?.value !== true) {
      this.logger.debug(
        '[SubagentHandoffRecords] Task-folder stub not written',
        {
          timedOut: result === undefined,
        },
      );
    }
  }

  private async write(
    sessionId: string,
    toolCallId: string,
    text: string,
  ): Promise<HandoffRecordWrite> {
    const workspace = this.workspaceOf(sessionId);
    const name = workspace
      ? recordFileName(this.now(), sessionId, toolCallId, this.nonce())
      : undefined;
    const result: HandoffRecordWrite =
      !workspace || !name
        ? {
            ok: false,
            errorType: workspace ? 'InvalidToolCallId' : 'NoWorkspace',
          }
        : ((
            await withinHandoffTimeout(
              this.create(workspace, name, text),
              (late) => {
                if (late.ok) {
                  void this.unlinkLate(toolCallId, late.path);
                }
              },
            )
          )?.value ?? { ok: false, errorType: 'Timeout' });
    if (result.ok) {
      this.logger.info('[SubagentHandoffRecords] Handoff record saved', {
        sessionId,
        toolCallId,
      });
    } else {
      this.logger.warn('[SubagentHandoffRecords] Handoff record not saved', {
        sessionId,
        toolCallId,
        errorType: result.errorType,
        errorCode: result.errorCode,
      });
    }
    return result;
  }

  private async create(
    workspace: string,
    name: string,
    text: string,
  ): Promise<HandoffRecordWrite> {
    try {
      const check = await checkHandoffDir(workspace, true);
      if (!check.ok) {
        return { ok: false, errorType: 'GuardRefused' };
      }
      const recordPath = path.join(check.dir, name);
      await fs.writeFile(recordPath, renderRecord(text), {
        encoding: 'utf8',
        flag: 'wx',
      });
      return { ok: true, path: recordPath, workspace, name };
    } catch (error: unknown) {
      return { ok: false, ...errorDetails(error) };
    }
  }

  /** A write that finished after its timeout: the stop never used it. */
  private async unlinkLate(
    toolCallId: string,
    recordPath: string,
  ): Promise<void> {
    try {
      await fs.unlink(recordPath);
    } catch (error: unknown) {
      this.logger.warn(
        '[SubagentHandoffRecords] Late handoff record not withdrawn',
        { toolCallId, ...errorDetails(error) },
      );
    }
  }

  /** `true` when the stub was written. */
  private async createStub(
    workspace: string,
    folder: string,
    fileName: string,
    recordPath: string,
  ): Promise<boolean> {
    try {
      const ptah = path.join(workspace, '.ptah');
      const specs = path.join(ptah, 'specs');
      const target = path.resolve(workspace, folder);
      if (!(await realDirectories([ptah, specs, target]))) {
        return false;
      }
      const [realSpecs, realTarget] = await Promise.all([
        fs.realpath(specs),
        fs.realpath(target),
      ]);
      if (!samePath(path.dirname(realTarget), realSpecs)) {
        return false;
      }
      await fs.writeFile(
        path.join(target, fileName),
        'Ptah subagent handoff stub. Never edit this file. The handoff ' +
          `record is \`${recordPath}\`: if its frontmatter has ` +
          '`status: pending`, read it, continue from it, then set ' +
          '`status: consumed` in the record.\n',
        { encoding: 'utf8', flag: 'wx' },
      );
      return true;
    } catch (error: unknown) {
      this.logger.debug('[SubagentHandoffRecords] Task-folder stub refused', {
        ...errorDetails(error),
      });
      return false;
    }
  }
}

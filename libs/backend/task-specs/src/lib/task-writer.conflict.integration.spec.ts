/**
 * The loss interleaving — a regression test for the bug that started
 * TASK_2026_179 (step 19).
 *
 * ## What actually went wrong
 *
 * Two writers touch `task.md` and neither knows about the other:
 *
 *  - The Tasks board, via `TaskWriterService.updateStatus` — read the file,
 *    splice the status, write it back.
 *  - An external Claude Code doing a plain `Edit`, or a second host, or a
 *    human — a WHOLE-FILE write built from a snapshot it read earlier.
 *
 * When the external write lands inside the board's read→write window, the
 * board's write is computed from a snapshot that is already stale, so writing
 * it discards everything the other writer did. `.ptah/**` is gitignored, so
 * there is no `git checkout` to get it back. The status just quietly reverts,
 * which is why this went unnoticed long enough to need a whole task set.
 *
 * ## What this test pins
 *
 * The interleaving is forced deterministically rather than raced: the mock's
 * `readFile` performs the external write as a side effect of the writer's FIRST
 * read, which places it exactly in the window — after the board has its
 * snapshot, before the board writes.
 *
 * The assertion is deliberately shaped so it CANNOT pass by accident. It is not
 * "the board's own status survived" — that is true in the broken build too,
 * because clobbering is precisely how the board's status wins. It is: either
 * the write was REFUSED with `TASK_CONFLICT`, or the OTHER writer's change is
 * still on disk. In a build without the pre-write re-read, neither holds and
 * this suite goes red.
 *
 * ## Why the writer, not the RPC handler
 *
 * `TasksRpcHandlers.updateStatus` delegates to `TaskWriterService.updateStatus`
 * verbatim and adds only Zod parsing and root resolution. The handler lives in
 * `rpc-handlers`, which depends on THIS lib — importing it here would invert
 * the dependency. The write path under test is identical either way.
 *
 * ## Assert on PARSED status, never on frontmatter bytes
 *
 * `updateFrontmatter` re-dumps through `matter.stringify`. It preserves the
 * body byte-for-byte but is NOT byte-preserving across the frontmatter block —
 * quoting and key spacing can shift. So frontmatter is compared through
 * `parseTaskFile`, and only the body is compared as bytes.
 */
import * as path from 'path';
import {
  createMockFileSystemProvider,
  type MockFileSystemProvider,
} from '@ptah-extension/platform-core/testing';
import {
  CARRIER_FILE,
  renderTaskMd,
  type TaskStatus,
} from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';

import { normalizeWorkspaceRoot } from './normalize-workspace-root';
import { parseTaskFile, updateFrontmatter } from './task-frontmatter';
import { NoOpTaskIndexNotifier } from './task-index.port';
import { TaskWriterService } from './task-writer.service';

const WORKSPACE = normalizeWorkspaceRoot('D:\\workspace');
const TASK_ID = 'TASK_2026_179';
const CARRIER = path.join(WORKSPACE, '.ptah', 'specs', TASK_ID, CARRIER_FILE);

function silentLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

/** Body text of a carrier, i.e. everything after the frontmatter block. */
function bodyOf(raw: string): string {
  const parsed = parseTaskFile(TASK_ID, raw);
  if (parsed.kind !== 'task') {
    throw new Error(`carrier was excluded: ${parsed.excluded.reason}`);
  }
  return parsed.body;
}

function statusOf(raw: string): string {
  const parsed = parseTaskFile(TASK_ID, raw);
  if (parsed.kind !== 'task') {
    throw new Error(`carrier was excluded: ${parsed.excluded.reason}`);
  }
  return parsed.task.status;
}

interface Harness {
  fs: MockFileSystemProvider;
  writer: TaskWriterService;
  /** Content the external writer put on disk. */
  externalContent: string;
  /** Content on disk before anything ran. */
  originalContent: string;
  /** How many times the external write actually fired. */
  externalWrites: () => number;
}

/**
 * Seed a carrier and arm the external writer to fire inside the writer's
 * read→write window.
 *
 * @param externalStatus status the external writer records. It reaches disk as
 *   a WHOLE-FILE write built from the pre-update snapshot, which is what an
 *   external `Edit` or a second host actually does.
 */
async function buildHarness(externalStatus: TaskStatus): Promise<Harness> {
  const fs = createMockFileSystemProvider();

  const originalContent = renderTaskMd({
    id: TASK_ID,
    title: 'Carrier under contention',
    type: 'REFACTORING',
    status: 'backlog',
    now: '2026-08-04T00:00:00.000Z',
  });
  await fs.writeFile(CARRIER, originalContent);

  // The other writer's whole-file result: a different status AND a body edit,
  // so the test can tell "status preserved" from "file preserved".
  const externalContent = `${updateFrontmatter(originalContent, {
    status: externalStatus,
  })}\nAn external agent appended this paragraph.\n`;

  const defaultReadFile = fs.readFile.getMockImplementation() as (
    p: string,
  ) => Promise<string>;
  const defaultWriteFile = fs.writeFile.getMockImplementation() as (
    p: string,
    content: string,
  ) => Promise<void>;

  let armed = true;
  let externalWrites = 0;
  fs.readFile.mockImplementation(async (p: string): Promise<string> => {
    const content = await defaultReadFile(p);
    if (p === CARRIER && armed) {
      // Fire ONCE, immediately after the writer takes its snapshot. This is
      // the whole point: the external write lands after the read and before
      // the write, which is the window the pre-write re-read exists to close.
      armed = false;
      externalWrites++;
      await defaultWriteFile(CARRIER, externalContent);
    }
    return content;
  });

  const writer = new TaskWriterService(
    fs,
    silentLogger(),
    new NoOpTaskIndexNotifier(),
  );

  return {
    fs,
    writer,
    externalContent,
    originalContent,
    externalWrites: () => externalWrites,
  };
}

describe('TaskWriterService.updateStatus — the loss interleaving', () => {
  it('reproduces the exact interleaving: read → update → external whole-file write', async () => {
    const harness = await buildHarness('done');

    const result = await harness.writer.updateStatus(
      WORKSPACE,
      TASK_ID,
      'in_progress',
    );

    // The interleaving really happened — otherwise everything below is vacuous.
    expect(harness.externalWrites()).toBe(1);

    const onDisk = await harness.fs.__state.files.get(CARRIER);
    expect(onDisk).toBeDefined();
    const finalRaw = new TextDecoder().decode(onDisk as Uint8Array);

    // THE ASSERTION.
    //
    // Either the write was refused, or the other writer's change survived. Note
    // what is NOT asserted: that the board's own `in_progress` landed. In a
    // build without the pre-write re-read that IS what happens — the clobber is
    // the bug, not the fix — so asserting it would make this suite green
    // against the very defect it exists to catch.
    const refused = !result.success && result.error.code === 'TASK_CONFLICT';
    const otherWriterSurvived = statusOf(finalRaw) === 'done';
    expect(refused || otherWriterSurvived).toBe(true);
  });

  it('refuses with TASK_CONFLICT and leaves the external write fully intact', async () => {
    const harness = await buildHarness('done');

    const result = await harness.writer.updateStatus(
      WORKSPACE,
      TASK_ID,
      'in_progress',
    );

    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected a refusal');
    expect(result.error.code).toBe('TASK_CONFLICT');

    const finalRaw = new TextDecoder().decode(
      harness.fs.__state.files.get(CARRIER) as Uint8Array,
    );

    // Frontmatter is compared through the PARSER, not as bytes:
    // `updateFrontmatter` re-dumps via `matter.stringify`, so the block is
    // semantically stable but not byte-stable.
    expect(statusOf(finalRaw)).toBe(statusOf(harness.externalContent));
    // The body IS byte-preserved, so it can be compared directly — and this is
    // where a clobber would show up as the lost paragraph.
    expect(bodyOf(finalRaw)).toBe(bodyOf(harness.externalContent));
    expect(finalRaw).toContain('An external agent appended this paragraph.');
  });

  /**
   * `backlog` → `blocked` and `in_review` → `cancelled` are same-length
   * strings. A size-or-mtime heuristic cannot see the difference, which is
   * exactly why the design rejected one in favour of a content comparison.
   */
  it('detects a same-length status change that size/mtime could not', async () => {
    const harness = await buildHarness('blocked');

    const result = await harness.writer.updateStatus(
      WORKSPACE,
      TASK_ID,
      'in_progress',
    );

    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected a refusal');
    expect(result.error.code).toBe('TASK_CONFLICT');

    const finalRaw = new TextDecoder().decode(
      harness.fs.__state.files.get(CARRIER) as Uint8Array,
    );
    expect(statusOf(finalRaw)).toBe('blocked');
  });

  it('still writes normally when nothing else touches the file', async () => {
    // The guard must not be a blanket refusal: an uncontended update has to
    // keep working, or "no data loss" would be trivially satisfiable.
    const fs = createMockFileSystemProvider();
    await fs.writeFile(
      CARRIER,
      renderTaskMd({
        id: TASK_ID,
        title: 'Uncontended',
        type: 'FEATURE',
        status: 'backlog',
        now: '2026-08-04T00:00:00.000Z',
      }),
    );
    const writer = new TaskWriterService(
      fs,
      silentLogger(),
      new NoOpTaskIndexNotifier(),
    );

    const result = await writer.updateStatus(WORKSPACE, TASK_ID, 'in_progress');

    expect(result.success).toBe(true);
    const finalRaw = new TextDecoder().decode(
      fs.__state.files.get(CARRIER) as Uint8Array,
    );
    expect(statusOf(finalRaw)).toBe('in_progress');
  });
});

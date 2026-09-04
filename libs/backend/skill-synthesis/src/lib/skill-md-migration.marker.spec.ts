/**
 * The SKILL.md migration marker gate — boot-cost regression spec
 * (TASK_2026_331 B4).
 *
 * THIS FILE ASSERTS CALL COUNTS, NEVER TIMING. A timing assertion on a warm
 * file-system cache is a coin flip on CI; "`readFileSync` was called zero
 * times" is the property the marker actually buys and it is exact.
 *
 * `node:fs` is mocked as a THIN WRAPPER over the real module — every function
 * keeps its real implementation and only gains a `jest.fn` counter. That is
 * deliberate: a hand-written fake file system would let the walk pass against a
 * tree that does not behave like a tree, and the control test below (no marker
 * ⇒ 2000 `readFileSync` calls) is what proves the stub tree is real and the
 * gate is not simply always-on.
 *
 * WHAT WAS PROVED BEFORE THE CHANGE. `migrateSkillMdFiles` was first given the
 * `marker` parameter with BOTH seams stubbed out (`isMarkerCurrent` →
 * `return false`, `writeMarker` → no-op — i.e. exactly today's behaviour behind
 * tomorrow's signature) and this file was run against it: 7 of the 12 cases
 * FAILED.
 *
 * The other 5 are NEGATIVE cases ("the walk still runs"), which no-op code
 * passes for free — a test that cannot fail against the unfixed code is worth
 * nothing. Each was therefore killed by a targeted mutation of the finished
 * implementation instead, and every case in this file is killed by at least one
 * of:
 *
 *   M0  both seams no-op (the pre-change code) → 7 fail
 *   M2  `if (result.errors.length === 0)` → `if (true)`, i.e. write the marker
 *       after a walk that errored → "does NOT write … when a file … failed",
 *       "keeps one marker per root"
 *   M3  drop the `ageMs < 0` guard → "walks when the marker is stamped in the
 *       future"
 *   M4  rethrow instead of catching a marker-read failure → "walks when the
 *       marker store throws"
 *   M5  `if (!state) return true`, i.e. treat an ABSENT marker as current →
 *       the control case + 4 others
 *   M6  write the marker even when the root could not be read at all → "does
 *       NOT write the marker when the root cannot be read at all"
 *   M7  `if (!marker) return true`, i.e. treat "no store" as "already done" →
 *       "walks when no marker store is supplied at all"
 */
import * as path from 'node:path';
import * as os from 'node:os';
import {
  SKILL_MD_MIGRATION_RESCAN_INTERVAL_MS,
  SKILL_MD_MIGRATION_VERSION,
  migrateSkillMdFiles,
  type SkillMdMigrationMarkerState,
  type SkillMdMigrationMarkerStore,
} from './skill-md-migration';

jest.mock('node:fs', () => {
  const actual = jest.requireActual('node:fs');
  return {
    ...actual,
    readdirSync: jest.fn(actual.readdirSync),
    readFileSync: jest.fn(actual.readFileSync),
    writeFileSync: jest.fn(actual.writeFileSync),
  };
});

// Imported AFTER the mock declaration for readability only — `jest.mock` is
// hoisted, so this binding is already the wrapped module.
import * as fs from 'node:fs';

const readdirSyncMock = fs.readdirSync as unknown as jest.Mock;
const readFileSyncMock = fs.readFileSync as unknown as jest.Mock;

const logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

/**
 * The plan's figure, kept verbatim: the real `~/.ptah/skills` measured on
 * 2026-08-28 held 2420 `SKILL.md` files and cost 388 ms to walk and read.
 */
const STUB_FILE_COUNT = 2000;

const MIGRATED_STUB = `---
name: stub
description: already migrated
when_to_use: "already migrated"
---

## Description
Nothing to do here.
`;

const MIGRATABLE_STUB = `---
name: needs-migration
description: has a when-to-use section
---

## Description
Body.

## When to use
- When the migration must actually run
`;

/** A fake marker store that records its calls and keeps rows per root. */
function makeMarker(seed: Record<string, SkillMdMigrationMarkerState> = {}): {
  store: SkillMdMigrationMarkerStore;
  rows: Map<string, SkillMdMigrationMarkerState>;
  read: jest.Mock;
  write: jest.Mock;
} {
  const rows = new Map<string, SkillMdMigrationMarkerState>(
    Object.entries(seed),
  );
  const read = jest.fn(
    (root: string): SkillMdMigrationMarkerState | null =>
      rows.get(root) ?? null,
  );
  const write = jest.fn((root: string, state: SkillMdMigrationMarkerState) => {
    rows.set(root, state);
  });
  return { store: { read, write }, rows, read, write };
}

function currentState(): SkillMdMigrationMarkerState {
  return {
    migrationVersion: SKILL_MD_MIGRATION_VERSION,
    lastScanAt: Date.now() - 60_000,
  };
}

const realFs = jest.requireActual('node:fs') as typeof fs;

function makeTmpDir(): string {
  return realFs.mkdtempSync(path.join(os.tmpdir(), 'ptah-md-marker-'));
}

function writeSkillMd(dir: string, slug: string, content: string): string {
  const skillDir = path.join(dir, slug);
  realFs.mkdirSync(skillDir, { recursive: true });
  const filePath = path.join(skillDir, 'SKILL.md');
  realFs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

// ── The gate: a current marker must cost zero file-system reads ─────────────

describe('migrateSkillMdFiles — the marker gate over a large tree', () => {
  let bigRoot: string;

  beforeAll(() => {
    // Built once. Every file already carries `when_to_use:`, so a walk over it
    // is a pure read-and-skip and leaves the tree byte-identical — which is
    // what lets the control test and the negative tests share it.
    bigRoot = makeTmpDir();
    for (let i = 0; i < STUB_FILE_COUNT; i++) {
      writeSkillMd(bigRoot, `stub-${i}`, MIGRATED_STUB);
    }
  });

  afterAll(() => {
    realFs.rmSync(bigRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not call readdirSync or readFileSync when the marker is current', () => {
    const marker = makeMarker({ [bigRoot]: currentState() });

    const result = migrateSkillMdFiles(bigRoot, logger as never, marker.store);

    expect(readdirSyncMock).not.toHaveBeenCalled();
    expect(readFileSyncMock).not.toHaveBeenCalled();
    expect(result.skippedByMarker).toBe(true);
    expect(result).toEqual({
      migrated: 0,
      skipped: 0,
      errors: [],
      skippedByMarker: true,
    });
    // A gate that skipped the walk must not then claim the root was re-scanned.
    expect(marker.write).not.toHaveBeenCalled();
  });

  it('walks the whole tree when there is no marker at all (control)', () => {
    // The control that makes the assertion above mean something: it proves the
    // stub tree is real, that the walk reads every file in it, and that the
    // gate is not simply refusing to run for unrelated reasons.
    const marker = makeMarker();

    const result = migrateSkillMdFiles(bigRoot, logger as never, marker.store);

    expect(readdirSyncMock).toHaveBeenCalled();
    expect(readFileSyncMock).toHaveBeenCalledTimes(STUB_FILE_COUNT);
    expect(result.skipped).toBe(STUB_FILE_COUNT);
    expect(result.skippedByMarker).toBe(false);
  });

  it('walks when no marker store is supplied at all (host without persistence)', () => {
    const result = migrateSkillMdFiles(bigRoot, logger as never);

    expect(readFileSyncMock).toHaveBeenCalledTimes(STUB_FILE_COUNT);
    expect(result.skippedByMarker).toBe(false);
  });

  it('walks and REWRITES the marker when the stored migration_version differs', () => {
    // The write half is what fails against an implementation that ignores the
    // version: such an implementation skips the walk, so it neither reads the
    // files nor refreshes the row to the current version.
    const stale: SkillMdMigrationMarkerState = {
      migrationVersion: SKILL_MD_MIGRATION_VERSION + 1,
      lastScanAt: Date.now(),
    };
    const marker = makeMarker({ [bigRoot]: stale });

    const result = migrateSkillMdFiles(bigRoot, logger as never, marker.store);

    expect(readFileSyncMock).toHaveBeenCalledTimes(STUB_FILE_COUNT);
    expect(result.skippedByMarker).toBe(false);
    expect(marker.rows.get(bigRoot)?.migrationVersion).toBe(
      SKILL_MD_MIGRATION_VERSION,
    );
  });

  it('walks and REFRESHES the marker when it is older than 24 hours', () => {
    const before = Date.now();
    const stale: SkillMdMigrationMarkerState = {
      migrationVersion: SKILL_MD_MIGRATION_VERSION,
      lastScanAt: before - SKILL_MD_MIGRATION_RESCAN_INTERVAL_MS - 60_000,
    };
    const marker = makeMarker({ [bigRoot]: stale });

    const result = migrateSkillMdFiles(bigRoot, logger as never, marker.store);

    expect(readFileSyncMock).toHaveBeenCalledTimes(STUB_FILE_COUNT);
    expect(result.skippedByMarker).toBe(false);
    expect(marker.rows.get(bigRoot)?.lastScanAt).toBeGreaterThanOrEqual(before);
  });

  it('walks when the marker is stamped in the future', () => {
    // A clock change must not be able to suppress the migration for a day.
    const marker = makeMarker({
      [bigRoot]: {
        migrationVersion: SKILL_MD_MIGRATION_VERSION,
        lastScanAt: Date.now() + 60 * 60 * 1000,
      },
    });

    const result = migrateSkillMdFiles(bigRoot, logger as never, marker.store);

    expect(readFileSyncMock).toHaveBeenCalledTimes(STUB_FILE_COUNT);
    expect(result.skippedByMarker).toBe(false);
  });

  it('walks when the marker store throws (SQLite unavailable)', () => {
    // `SkillMdMigrationStateStore` swallows its own failures, but a port cannot
    // enforce that on implementors, and `connection.db` throws
    // `PERSISTENCE_UNAVAILABLE` when the database is not open. A marker-read
    // failure must never skip real migration work, and must not escape either.
    const boom = new Error('PERSISTENCE_UNAVAILABLE');
    const store: SkillMdMigrationMarkerStore = {
      read: jest.fn(() => {
        throw boom;
      }),
      write: jest.fn(),
    };

    const result = migrateSkillMdFiles(bigRoot, logger as never, store);

    expect(readFileSyncMock).toHaveBeenCalledTimes(STUB_FILE_COUNT);
    expect(result.skippedByMarker).toBe(false);
    // The walk succeeded, so it still tries to record the marker.
    expect(store.write).toHaveBeenCalledTimes(1);
  });

  it('does not let a failing marker WRITE break the migration', () => {
    const store: SkillMdMigrationMarkerStore = {
      read: jest.fn(() => null),
      write: jest.fn(() => {
        throw new Error('disk full');
      }),
    };

    const result = migrateSkillMdFiles(bigRoot, logger as never, store);

    expect(result.skipped).toBe(STUB_FILE_COUNT);
    expect(result.errors).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalled();
  });
});

// ── The write side: only a clean walk may record a marker ───────────────────

describe('migrateSkillMdFiles — when the marker is written', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('records the current version and a fresh timestamp after a clean walk', () => {
    const tmpDir = makeTmpDir();
    try {
      writeSkillMd(tmpDir, 'needs-migration', MIGRATABLE_STUB);
      const marker = makeMarker();
      const before = Date.now();

      const result = migrateSkillMdFiles(tmpDir, logger as never, marker.store);

      expect(result.migrated).toBe(1);
      expect(marker.write).toHaveBeenCalledTimes(1);
      const stored = marker.rows.get(tmpDir);
      expect(stored?.migrationVersion).toBe(SKILL_MD_MIGRATION_VERSION);
      expect(stored?.lastScanAt).toBeGreaterThanOrEqual(before);
    } finally {
      realFs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('does NOT write the marker when a file in the walk failed', () => {
    const tmpDir = makeTmpDir();
    try {
      writeSkillMd(tmpDir, 'a', MIGRATABLE_STUB);
      writeSkillMd(tmpDir, 'b', MIGRATABLE_STUB);
      const marker = makeMarker();
      // One unreadable file. Cross-platform: `chmod` is unreliable on Windows,
      // and the failure mode we care about is "the read threw", not "the ACL
      // said no".
      readFileSyncMock.mockImplementationOnce(() => {
        throw new Error('EACCES');
      });

      const result = migrateSkillMdFiles(tmpDir, logger as never, marker.store);

      expect(result.errors).toHaveLength(1);
      // Files still carry the old shape. Marking the root done would abandon
      // them for the whole freshness window, and again on every later launch
      // for as long as the failure persists.
      expect(marker.write).not.toHaveBeenCalled();
      expect(marker.rows.has(tmpDir)).toBe(false);
    } finally {
      realFs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('does NOT write the marker when the root cannot be read at all', () => {
    const marker = makeMarker();

    const result = migrateSkillMdFiles(
      path.join(os.tmpdir(), 'ptah-md-marker-does-not-exist'),
      logger as never,
      marker.store,
    );

    expect(result.migrated + result.skipped).toBe(0);
    expect(marker.write).not.toHaveBeenCalled();
  });

  it('keeps one marker per root, so a failed root does not mark the other done', () => {
    // The two roots are walked back to back by `SkillSynthesisService.start()`.
    // This is the case that decided one-row-per-root over a single shared row.
    const activeRoot = makeTmpDir();
    const candidatesRoot = makeTmpDir();
    try {
      writeSkillMd(activeRoot, 'ok', MIGRATABLE_STUB);
      writeSkillMd(candidatesRoot, 'broken', MIGRATABLE_STUB);
      const marker = makeMarker();

      const activeResult = migrateSkillMdFiles(
        activeRoot,
        logger as never,
        marker.store,
      );
      readFileSyncMock.mockImplementationOnce(() => {
        throw new Error('EACCES');
      });
      const candidatesResult = migrateSkillMdFiles(
        candidatesRoot,
        logger as never,
        marker.store,
      );

      expect(activeResult.errors).toHaveLength(0);
      expect(candidatesResult.errors).toHaveLength(1);
      expect(marker.rows.has(activeRoot)).toBe(true);
      expect(marker.rows.has(candidatesRoot)).toBe(false);

      // And the next launch consequently skips the good root and re-walks the
      // failed one — the behaviour a shared row could not express.
      jest.clearAllMocks();
      expect(
        migrateSkillMdFiles(activeRoot, logger as never, marker.store)
          .skippedByMarker,
      ).toBe(true);
      expect(readdirSyncMock).not.toHaveBeenCalled();
      expect(
        migrateSkillMdFiles(candidatesRoot, logger as never, marker.store)
          .skippedByMarker,
      ).toBe(false);
      expect(readdirSyncMock).toHaveBeenCalled();
    } finally {
      realFs.rmSync(activeRoot, { recursive: true, force: true });
      realFs.rmSync(candidatesRoot, { recursive: true, force: true });
    }
  });
});

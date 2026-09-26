/**
 * extract-eval — M4 extraction eval, old prompt against new
 * (implementation-plan.md measurement table "M4 extraction", plan:1029;
 * rubric: quarantine-rules.md §2 + §4.2).
 *
 * LABEL (plan:926-932): this is a PROMPT-ONLY, LIMITED EVALUATION. MCP tools
 * are OFF for both variants, so the new prompt's reuse-by-search lever
 * (`ptah_memory_search`) is not exercised; turning search off can change the
 * model's behaviour and recall in either direction.
 *
 * Modes:
 *   sample   Draw the session sample only and write output/m4-sample.json.
 *   probe    One extract call (new prompt) on a 3-line synthetic transcript,
 *            to prove auth/transport before the full run.
 *   run      Full run. Every call is appended to %TEMP%\mqs-563-eval\m4-calls.jsonl
 *            as it completes; a re-run resumes (skips units already recorded).
 *   report   Aggregate m4-calls.jsonl into output/m4-extraction.json and
 *            output/m4-drafts.json (no LLM calls).
 *
 * Sample (plan:1029): seed `TASK_2026_563_2939:m4`; sessions under
 * ~/.claude/projects/D--projects-ptah-extension/ with a JSONL of
 * 200 KiB..5 MiB, not modified in the last 24 h, and >= 1 memory on the copy
 * (memories.session_id = file stem, workspace_root = D:\projects\ptah-extension);
 * ordered by sha256(seed + ':' + filename) ascending; first 10.
 *
 * Per session: the REAL SessionHistoryReaderService.readHistoryForCuration
 * (real JsonlReaderService + HistoryEventFactory; the seven collaborators this
 * path never touches are null — see README), joined exactly as
 * SdkTranscriptReaderAdapter.read does, trimmed as doCurate does, then the
 * REAL planCuratorWindows (default budget, at most 8 windows). Each window is
 * sent to SdkInternalQueryCuratorLlm.extract with the OLD and the NEW prompt;
 * the order alternates by global window index (even: old first, odd: new
 * first) to cancel ordering bias.
 */
import 'reflect-metadata';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SessionHistoryReaderService } from '../../../../libs/backend/agent-sdk/src/lib/session-history-reader.service';
import { JsonlReaderService } from '../../../../libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service';
import { HistoryEventFactory } from '../../../../libs/backend/agent-sdk/src/lib/helpers/history/history-event-factory';
import { planCuratorWindows } from '../../../../libs/backend/memory-curator/src/lib/curator-llm/transcript-windows';
import { EVAL_DIR, makeWorkingCopy } from './lib/copy-db';
import { makeLogger, openWorkingCopy } from './lib/connection';
import {
  buildCuratorLlm,
  callLabel,
  type LlmCallRecord,
  type PromptVariant,
} from './lib/llm';

const OUT_DIR =
  process.env['MQS_OUT_DIR'] ??
  'D:\\projects\\ptah-extension-memory-quality-source\\.ptah\\specs\\TASK_2026_563_2939\\harness\\output';
const WORKSPACE = 'D:\\projects\\ptah-extension';
const SEED = 'TASK_2026_563_2939:m4';
const SESSIONS_DIR = path.join(
  os.homedir(),
  '.claude',
  'projects',
  'D--projects-ptah-extension',
);
const MIN_BYTES = 200 * 1024;
const MAX_BYTES = 5 * 1024 * 1024;
const SAMPLE_SIZE = 10;
const CONCURRENCY = Number(process.env['MQS_M4_CONCURRENCY'] ?? '3');
const COPY_NAME = 'm4-unmigrated.sqlite';
const CALLS_FILE = path.join(EVAL_DIR, 'm4-calls.jsonl');
const SAMPLE_FILE = path.join(OUT_DIR, 'm4-sample.json');

interface Draft {
  kind: string;
  subject: string | null;
  content: string;
  [k: string]: unknown;
}

interface UnitResult {
  sessionId: string;
  windowIndex: number;
  windowCount: number;
  windowChars: number;
  variant: PromptVariant;
  order: number;
  status: string;
  drafts: Draft[];
  extraction: unknown;
  llm: LlmCallRecord | null;
  error: string | null;
}

function writeJson(name: string, value: unknown): void {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(OUT_DIR, name),
    JSON.stringify(value, null, 2) + '\n',
  );
  process.stdout.write(`wrote ${path.join(OUT_DIR, name)}\n`);
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

async function ensureCopy(): Promise<string> {
  const target = path.join(EVAL_DIR, COPY_NAME);
  if (fs.existsSync(target)) return target; // created by an earlier `sample`; never overwritten
  const record = await makeWorkingCopy(COPY_NAME);
  writeJson('m4-working-copy.json', record);
  return record.target;
}

async function drawSample(): Promise<{
  sessions: Array<{
    file: string;
    sessionId: string;
    bytes: number;
    mtime: string;
    memories: number;
    hash: string;
  }>;
  meta: Record<string, unknown>;
}> {
  const copy = await ensureCopy();
  const conn = openWorkingCopy(copy, { readonly: true });
  try {
    const now = Date.now();
    const cutoff = now - 24 * 3600 * 1000;
    const countStmt = conn.db.prepare(
      'SELECT COUNT(*) AS n FROM memories WHERE session_id = ? AND workspace_root IS ?',
    );
    const all = fs
      .readdirSync(SESSIONS_DIR)
      .filter((f) => f.endsWith('.jsonl'));
    let sizeOk = 0;
    let closedOk = 0;
    const eligible = [];
    for (const file of all) {
      const st = fs.statSync(path.join(SESSIONS_DIR, file));
      if (st.size < MIN_BYTES || st.size > MAX_BYTES) continue;
      sizeOk++;
      if (st.mtimeMs >= cutoff) continue;
      closedOk++;
      const sessionId = file.slice(0, -'.jsonl'.length);
      const memories = Number(
        (countStmt.get(sessionId, WORKSPACE) as { n: number }).n,
      );
      if (memories < 1) continue;
      eligible.push({
        file,
        sessionId,
        bytes: st.size,
        mtime: new Date(st.mtimeMs).toISOString(),
        memories,
        hash: sha256(`${SEED}:${file}`),
      });
    }
    eligible.sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0));
    const sessions = eligible.slice(0, SAMPLE_SIZE);
    const meta = {
      seed: SEED,
      hashInput:
        "sha256(seed + ':' + filename), filename includes the .jsonl extension",
      sessionsDir: SESSIONS_DIR,
      drawnAt: new Date(now).toISOString(),
      mtimeCutoff: new Date(cutoff).toISOString(),
      sizeRangeBytes: [MIN_BYTES, MAX_BYTES],
      jsonlFiles: all.length,
      inSizeRange: sizeOk,
      inSizeRangeAndClosed: closedOk,
      eligibleWithMemoryOnCopy: eligible.length,
      memoryFilter:
        'memories.session_id = stem AND workspace_root IS D:\\projects\\ptah-extension (on the unmigrated working copy)',
    };
    return { sessions, meta };
  } finally {
    conn.close();
  }
}

function readDone(): UnitResult[] {
  if (!fs.existsSync(CALLS_FILE)) return [];
  return fs
    .readFileSync(CALLS_FILE, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as UnitResult);
}

async function planSession(
  reader: SessionHistoryReaderService,
  sessionId: string,
): Promise<{
  windows: Array<{ text: string; windowIndex: number; windowCount: number }>;
  messages: number;
  transcriptChars: number;
  compressedChars: number;
  clamped: boolean;
}> {
  const messages = await reader.readHistoryForCuration(sessionId, WORKSPACE);
  // SdkTranscriptReaderAdapter.read (sdk-transcript-reader.adapter.ts:28-39).
  const joined =
    messages.length === 0
      ? ''
      : messages
          .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
          .join('\n\n');
  // doCurate: `(input.transcript ?? '').trim()`.
  const transcript = joined.trim();
  if (transcript.length === 0) {
    return {
      windows: [],
      messages: messages.length,
      transcriptChars: 0,
      compressedChars: 0,
      clamped: false,
    };
  }
  const plan = planCuratorWindows(transcript);
  return {
    windows: plan.windows.map((w) => ({
      text: w.text,
      windowIndex: w.windowIndex,
      windowCount: w.windowCount,
    })),
    messages: messages.length,
    transcriptChars: plan.originalChars,
    compressedChars: plan.compressedChars,
    clamped: plan.clamped !== null,
  };
}

function buildReader(logger: never): SessionHistoryReaderService {
  // Constructor order (session-history-reader.service.ts:129-150): logger,
  // jsonlReader, replayService, eventFactory, modelResolver, authEnv,
  // pricingProvider, usageTracker, compactionBoundaryRegistry, statsOwner.
  // readHistoryForCuration -> readHistoryMessages -> projectHistoryMessages
  // (:679-753, :559-615) touches only logger, jsonlReader and eventFactory.
  return new SessionHistoryReaderService(
    logger,
    new JsonlReaderService(logger),
    null as never,
    new HistoryEventFactory(),
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
  );
}

async function runOne(
  llms: Record<PromptVariant, ReturnType<typeof buildCuratorLlm>>,
  records: Map<string, LlmCallRecord>,
  unit: {
    sessionId: string;
    windowIndex: number;
    windowCount: number;
    text: string;
  },
  variant: PromptVariant,
  order: number,
): Promise<UnitResult> {
  const label = `${unit.sessionId}#${unit.windowIndex}:${variant}`;
  let extraction: unknown = null;
  let error: string | null = null;
  try {
    extraction = await callLabel.run(label, () =>
      llms[variant].extract(unit.text),
    );
  } catch (err: unknown) {
    const cause =
      err instanceof Error && err.cause instanceof Error
        ? ` (cause: ${err.cause.message})`
        : '';
    error = `${err instanceof Error ? err.message : String(err)}${cause}`;
  }
  const ex = extraction as { status?: string; drafts?: Draft[] } | null;
  return {
    sessionId: unit.sessionId,
    windowIndex: unit.windowIndex,
    windowCount: unit.windowCount,
    windowChars: unit.text.length,
    variant,
    order,
    status: error !== null ? 'error' : String(ex?.status ?? 'unknown'),
    drafts: ex?.status === 'extracted' ? [...(ex.drafts ?? [])] : [],
    extraction: ex && ex.status !== 'extracted' ? ex : null,
    llm: records.get(label) ?? null,
    error,
  };
}

async function runAll(probeOnly: boolean): Promise<void> {
  const logger = makeLogger('extract-eval', true);
  const records = new Map<string, LlmCallRecord>();
  const sink = (r: LlmCallRecord): void => {
    records.set(r.label, r);
  };
  const llms = {
    old: buildCuratorLlm('old', logger, WORKSPACE, sink),
    new: buildCuratorLlm('new', logger, WORKSPACE, sink),
  };
  if (probeOnly) {
    const probeText =
      'USER: We decided that SQLite migrations must never interpolate template strings; static SQL only, because Semgrep blocks injection.\n\nASSISTANT: Understood — migrations stay static text.\n\nUSER: Also PR #999 CI is green now.';
    const r = await runOne(
      llms,
      records,
      { sessionId: 'probe', windowIndex: 0, windowCount: 1, text: probeText },
      'new',
      0,
    );
    writeJson('m4-probe.json', r);
    return;
  }
  const sample = JSON.parse(fs.readFileSync(SAMPLE_FILE, 'utf8')) as {
    sessions: Array<{ sessionId: string }>;
  };
  const reader = buildReader(logger);
  const units: Array<{
    sessionId: string;
    windowIndex: number;
    windowCount: number;
    text: string;
    globalIndex: number;
  }> = [];
  const windowsMeta: Array<Record<string, unknown>> = [];
  for (const s of sample.sessions) {
    const planned = await planSession(reader, s.sessionId);
    windowsMeta.push({
      sessionId: s.sessionId,
      messages: planned.messages,
      transcriptChars: planned.transcriptChars,
      compressedChars: planned.compressedChars,
      clamped: planned.clamped,
      windows: planned.windows.length,
      windowChars: planned.windows.map((w) => w.text.length),
    });
    for (const w of planned.windows) {
      units.push({
        sessionId: s.sessionId,
        windowIndex: w.windowIndex,
        windowCount: w.windowCount,
        text: w.text,
        globalIndex: units.length,
      });
    }
  }
  writeJson('m4-windows.json', {
    windows: windowsMeta,
    totalWindows: units.length,
    maxCalls: units.length * 2,
  });

  const done = readDone();
  const doneKey = new Set(
    done
      .filter((d) => d.status !== 'error')
      .map((d) => `${d.sessionId}#${d.windowIndex}:${d.variant}`),
  );
  let consecutiveErrors = 0;
  let stopped: string | null = null;
  let next = 0;
  const worker = async (): Promise<void> => {
    while (stopped === null) {
      const i = next++;
      if (i >= units.length) return;
      const unit = units[i];
      const order: PromptVariant[] =
        unit.globalIndex % 2 === 0 ? ['old', 'new'] : ['new', 'old'];
      for (let k = 0; k < order.length; k++) {
        const variant = order[k];
        if (doneKey.has(`${unit.sessionId}#${unit.windowIndex}:${variant}`))
          continue;
        if (stopped !== null) return;
        const result = await runOne(llms, records, unit, variant, k);
        fs.appendFileSync(CALLS_FILE, JSON.stringify(result) + '\n');
        process.stdout.write(
          `${new Date().toISOString()} ${unit.sessionId}#${unit.windowIndex}/${unit.windowCount} ${variant} -> ${result.status} drafts=${result.drafts.length} ${result.llm ? `${result.llm.durationMs}ms in=${result.llm.usage.input_tokens} out=${result.llm.usage.output_tokens}` : ''}${result.error ? ' ERR ' + result.error : ''}\n`,
        );
        if (result.status === 'error' || result.status === 'stalled') {
          consecutiveErrors++;
          if (consecutiveErrors >= 3) {
            stopped = `stopped after 3 consecutive failures; last: ${result.error ?? JSON.stringify(result.extraction)}`;
          }
        } else {
          consecutiveErrors = 0;
        }
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  if (stopped !== null) {
    process.stdout.write(`RUN STOPPED: ${stopped}\n`);
    fs.writeFileSync(path.join(EVAL_DIR, 'm4-stopped.txt'), stopped + '\n');
  }
}

function norm(subject: string | null): string | null {
  if (subject === null || subject === undefined) return null;
  const s = subject.trim().toLowerCase();
  return s.length === 0 ? null : s;
}

async function report(): Promise<void> {
  const all = readDone();
  // Keep the latest record per unit (a resumed run may have retried errors).
  const latest = new Map<string, UnitResult>();
  for (const r of all)
    latest.set(`${r.sessionId}#${r.windowIndex}:${r.variant}`, r);
  const results = [...latest.values()].filter((r) => r.sessionId !== 'probe');
  const copy = path.join(EVAL_DIR, COPY_NAME);
  const conn = openWorkingCopy(copy, { readonly: true });
  const existsStmt = conn.db.prepare(
    'SELECT COUNT(*) AS n FROM memories WHERE workspace_root IS ? AND TRIM(LOWER(subject)) = ?',
  );
  const perVariant: Record<string, unknown> = {};
  const draftsOut: Array<Record<string, unknown>> = [];
  try {
    for (const variant of ['old', 'new'] as const) {
      const rs = results.filter((r) => r.variant === variant);
      const drafts = rs.flatMap((r) =>
        r.drafts.map((d, i) => ({
          ...d,
          sessionId: r.sessionId,
          windowIndex: r.windowIndex,
          draftIndex: i,
        })),
      );
      const subjectCounts = new Map<string, number>();
      let nullSubjects = 0;
      for (const d of drafts) {
        const s = norm(d.subject);
        if (s === null) nullSubjects++;
        else subjectCounts.set(s, (subjectCounts.get(s) ?? 0) + 1);
      }
      const distinct = subjectCounts.size;
      const singleUse = [...subjectCounts.values()].filter(
        (n) => n === 1,
      ).length;
      const existing = [...subjectCounts.keys()].filter(
        (s) => Number((existsStmt.get(WORKSPACE, s) as { n: number }).n) > 0,
      );
      const statusCounts: Record<string, number> = {};
      for (const r of rs)
        statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
      const tokens = rs.reduce(
        (acc, r) => {
          const u = r.llm?.usage;
          if (u) {
            acc.input += u.input_tokens;
            acc.output += u.output_tokens;
            acc.cacheRead += u.cache_read_input_tokens;
            acc.cacheCreation += u.cache_creation_input_tokens;
          }
          acc.costUsd += r.llm?.totalCostUsd ?? 0;
          return acc;
        },
        { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, costUsd: 0 },
      );
      perVariant[variant] = {
        calls: rs.length,
        callsWithLlmRecord: rs.filter((r) => r.llm !== null).length,
        statusCounts,
        totalDrafts: drafts.length,
        draftsWithNullSubject: nullSubjects,
        distinctCaseFoldedSubjects: distinct,
        singleUseSubjects: singleUse,
        singleUseShare:
          distinct === 0
            ? null
            : Number(((singleUse / distinct) * 100).toFixed(1)),
        subjectsAlreadyOnCopyForWorkspace: existing.length,
        subjectsAlreadyOnCopyList: existing.sort(),
        kinds: drafts.reduce<Record<string, number>>((acc, d) => {
          acc[d.kind] = (acc[d.kind] ?? 0) + 1;
          return acc;
        }, {}),
        toolUseCalls: rs.filter((r) => (r.llm?.toolUses.length ?? 0) > 0)
          .length,
        resolvedModels: [
          ...new Set(rs.map((r) => r.llm?.resolvedModel ?? null)),
        ],
        tokens,
        meanDurationMs:
          rs.length === 0
            ? null
            : Math.round(
                rs.reduce((a, r) => a + (r.llm?.durationMs ?? 0), 0) /
                  rs.length,
              ),
      };
      for (const d of drafts) draftsOut.push({ variant, ...d });
    }
  } finally {
    conn.close();
  }
  const probe = all.filter((r) => r.sessionId === 'probe');
  writeJson('m4-extraction.json', {
    label:
      'prompt-only, limited evaluation (MCP tools off for both variants; implementation-plan.md:926-932)',
    llmCallsTotal:
      all.length + (fs.existsSync(path.join(OUT_DIR, 'm4-probe.json')) ? 1 : 0),
    llmCallsInRun: results.length,
    probeCallsInCallsFile: probe.length,
    perVariant,
    orderMethod:
      'per window, variant order alternates by global window index: even -> old then new, odd -> new then old; units dispatched by a pool of ' +
      CONCURRENCY +
      ' workers',
  });
  writeJson('m4-drafts.json', draftsOut);
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === 'sample') {
    const s = await drawSample();
    writeJson('m4-sample.json', { ...s.meta, sessions: s.sessions });
    return;
  }
  if (mode === 'probe') return runAll(true);
  if (mode === 'run') return runAll(false);
  if (mode === 'report') return report();
  throw new Error('usage: extract-eval.cjs <sample|probe|run|report>');
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    process.stderr.write(
      `extract-eval FAILED: ${err instanceof Error ? err.stack : String(err)}\n`,
    );
    process.exit(1);
  },
);

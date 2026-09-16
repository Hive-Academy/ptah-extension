/**
 * ============================================================================
 * MEASUREMENT HARNESS — OPT-IN ONLY. THIS DOES NOT RUN IN CI.
 * ============================================================================
 *
 * Every `describe` below is `describe.skip` unless `PTAH_PREFILTER_CORPUS=1` is
 * set in the environment. It reads the DEVELOPER'S HOME DIRECTORY
 * (`~/.claude/projects/**\/*.jsonl`), so it is machine-dependent, slow (minutes,
 * hundreds of MB of JSONL) and would be meaningless on a CI runner with no
 * corpus. It asserts nothing about the product; it prints aggregate counts.
 *
 * PRIVACY: this file must never print, log or persist session CONTENT. Session
 * ids and numeric aggregates only. `ExtractedTrajectory.canonicalText` and
 * `shortDescription` are never read here — only `charLength`.
 *
 * Run:
 *   PTAH_PREFILTER_CORPUS=1 npx jest --config libs/backend/skill-synthesis/jest.config.ts \
 *     -t 'prefilter evidence narrowing' --runTestsByPath \
 *     libs/backend/skill-synthesis/src/lib/prefilter-corpus-measurement.spec.ts
 *
 * WHY THIS EXISTS
 * ---------------
 * Phase 3 removes the conversation-depth branch from `passesPrefilter`, and
 * prefilter success is what chains the nightly, token-spending `archaeology`
 * stage. This measures how many sessions stop being eligible, using the REAL
 * `TrajectoryExtractor` (so `editCount`/`toolUseCount`/`charLength`/`turnCount`
 * are the product's own numbers, not a reimplementation) and the REAL private
 * `passesPrefilter` on a real `SkillSynthesisService` instance.
 *
 * The OLD phase-2 predicate is necessarily re-stated here because its depth
 * branch no longer exists in production.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { JsonlReaderService } from '@ptah-extension/agent-sdk';
import {
  MIN_ROLE_TURNS_FLOOR,
  TrajectoryExtractor,
  type ExtractedTrajectory,
} from './trajectory-extractor';
import { SkillSynthesisService } from './skill-synthesis.service';
import type { SkillSynthesisSettings } from './types';

const ENABLED = process.env['PTAH_PREFILTER_CORPUS'] === '1';
const suite = ENABLED ? describe : describe.skip;

const noopLogger = {
  info: () => undefined,
  warn: () => undefined,
  debug: () => undefined,
  error: () => undefined,
};

/** Production defaults — `FILE_BASED_SETTINGS_DEFAULTS` / `SETTINGS_DEFAULTS`. */
const OLD_SETTINGS = {
  eligibilityMinTurns: 5,
  prefilterMinEdits: 1,
  prefilterMinChars: 800,
  prefilterMinToolUses: 2,
};

const SETTINGS = {
  prefilterMinEdits: OLD_SETTINGS.prefilterMinEdits,
  prefilterMinToolUses: OLD_SETTINGS.prefilterMinToolUses,
} as unknown as SkillSynthesisSettings;

/**
 * The phase-2 predicate, including its conversation-depth branch.
 */
function passesPrefilterOld(t: ExtractedTrajectory): boolean {
  if (t.turnCount < MIN_ROLE_TURNS_FLOOR) return false;
  const editOk = t.editCount >= OLD_SETTINGS.prefilterMinEdits;
  const toolOk = t.toolUseCount >= OLD_SETTINGS.prefilterMinToolUses;
  const testOk = t.bashTestPassed === true;
  const depthOk =
    t.turnCount >= OLD_SETTINGS.eligibilityMinTurns &&
    t.charLength >= OLD_SETTINGS.prefilterMinChars;
  return editOk || toolOk || testOk || depthOk;
}

function listJsonl(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(full);
    }
  };
  walk(dir);
  return out;
}

suite('prefilter evidence narrowing — corpus measurement (opt-in)', () => {
  jest.setTimeout(45 * 60_000);

  it('counts OLD vs NEW eligibility over ~/.claude/projects', async () => {
    const projectsDir = path.join(os.homedir(), '.claude', 'projects');
    const workspaceDirs = fs
      .readdirSync(projectsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);

    const extractor = new TrajectoryExtractor(
      noopLogger as never,
      new JsonlReaderService(noopLogger as never),
    );

    // The REAL predicate. Everything the service needs for `passesPrefilter` is
    // its two arguments, so the remaining collaborators are never touched.
    const svc = new SkillSynthesisService(
      noopLogger as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      extractor,
      null,
      null as never,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    );
    const passesNew = (t: ExtractedTrajectory): boolean =>
      (
        svc as unknown as {
          passesPrefilter: (
            t: ExtractedTrajectory,
            s: SkillSynthesisSettings,
          ) => { ok: boolean };
        }
      ).passesPrefilter(t, SETTINGS).ok;

    let scanned = 0;
    let nullTrajectory = 0;
    let oldEligible = 0;
    let newEligible = 0;
    let phase2DepthOnly = 0;
    const perWorkspace: Record<
      string,
      { files: number; extracted: number; old: number; new: number }
    > = {};
    const perDay: Record<string, number> = {};
    const perDayEligibleNew: Record<string, number> = {};

    // Aggregate distributions, no content.
    const charLengths: number[] = [];
    const turnCounts: number[] = [];

    for (const ws of workspaceDirs) {
      const dir = path.join(projectsDir, ws);
      const files = listJsonl(dir);
      perWorkspace[ws] = { files: files.length, extracted: 0, old: 0, new: 0 };
      for (const file of files) {
        scanned++;
        const sessionId = path.basename(file, '.jsonl');
        const t = await extractor.extract(
          sessionId,
          // The un-escaped workspace root is not recoverable from the directory
          // name; `workspaceRoot` only feeds path normalization inside
          // canonicalText, which shifts charLength by a handful of characters
          // at most and cannot flip an 800-char threshold.
          ws.replace(/^([A-Za-z])--/, '$1:/').replace(/-/g, '/'),
          MIN_ROLE_TURNS_FLOOR,
          file,
        );
        if (!t) {
          nullTrajectory++;
          continue;
        }
        perWorkspace[ws].extracted++;
        charLengths.push(t.charLength);
        turnCounts.push(t.turnCount);

        const day = fs.statSync(file).mtime.toISOString().slice(0, 10);
        perDay[day] = (perDay[day] ?? 0) + 1;

        const o = passesPrefilterOld(t);
        const n = passesNew(t);
        if (o) {
          oldEligible++;
          perWorkspace[ws].old++;
        }
        if (n) {
          newEligible++;
          perWorkspace[ws].new++;
          perDayEligibleNew[day] = (perDayEligibleNew[day] ?? 0) + 1;
        }
        if (o && !n) {
          phase2DepthOnly++;
        }
      }
    }

    const pct = (n: number, d: number) =>
      d === 0 ? '0.0%' : `${((n / d) * 100).toFixed(1)}%`;
    const quantile = (xs: number[], q: number) => {
      const s = [...xs].sort((a, b) => a - b);
      return s[Math.min(s.length - 1, Math.floor(s.length * q))] ?? 0;
    };

    const days = Object.keys(perDay).sort();
    const report = {
      scanned,
      nullTrajectory,
      extracted: scanned - nullTrajectory,
      phase2Eligible: oldEligible,
      phase3Eligible: newEligible,
      retainedFraction:
        oldEligible === 0 ? null : +(newEligible / oldEligible).toFixed(3),
      removedFromEligibility: oldEligible - newEligible,
      phase2DepthOnly,
      phase2Rate: pct(oldEligible, scanned - nullTrajectory),
      phase3Rate: pct(newEligible, scanned - nullTrajectory),
      charLength: {
        p50: quantile(charLengths, 0.5),
        p90: quantile(charLengths, 0.9),
        p99: quantile(charLengths, 0.99),
        max: Math.max(0, ...charLengths),
        over12k: charLengths.filter((c) => c >= 12000).length,
      },
      turnCount: {
        p50: quantile(turnCounts, 0.5),
        p90: quantile(turnCounts, 0.9),
        max: Math.max(0, ...turnCounts),
      },
      perWorkspace,
      distinctDaysWithActivity: days.length,
      firstDay: days[0],
      lastDay: days[days.length - 1],
      perDay,
      perDayEligibleNew,
    };

    console.log('PREFILTER_CORPUS_REPORT ' + JSON.stringify(report, null, 2));
    expect(scanned).toBeGreaterThan(0);
  });
});

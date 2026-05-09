/**
 * SkillCuratorService — Hermes-style periodic skill curation daemon.
 *
 * Periodically reviews all promoted skills for overlap and staleness via an
 * LLM query. Never auto-deletes skills — only logs and reports. Pinned skills
 * are always exempt from all Curator actions.
 *
 * Reports are written to ~/.ptah/curator-reports/<ISO-timestamp>.md.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { SkillCandidateStore } from './skill-candidate.store';
import type { IInternalQuery } from './internal-query.interface';
import type { SkillSynthesisSettings } from './types';
import { INTERNAL_QUERY_SERVICE_TOKEN } from './di/tokens';
import { resolveJudgeModel } from './model-resolver';

/** Timeout for a single Curator LLM pass (60s — lists all promoted skills). */
const CURATOR_TIMEOUT_MS = 60_000;

export interface CuratorOverlap {
  skillIdA: string;
  skillIdB: string;
  reason: string;
}

export interface CuratorReport {
  reportPath: string;
  changesQueued: number;
  skippedPinned: number;
  overlaps: CuratorOverlap[];
}

/** Internal structure parsed from the LLM response. */
interface CuratorFinding {
  type: 'overlap' | 'stale';
  skillIds: string[];
  reason: string;
}

@injectable()
export class SkillCuratorService {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  /** Settings captured at the last `start()` call. Used by the interval callback. */
  private currentSettings: SkillSynthesisSettings | null = null;
  /** Interval hours at the last `start()` call — used to detect no-op restarts. */
  private currentIntervalHours: number | null = null;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SkillCandidateStore)
    private readonly store: SkillCandidateStore,
    @inject(INTERNAL_QUERY_SERVICE_TOKEN, { isOptional: true })
    private readonly internalQuery: IInternalQuery | null,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
  ) {}

  /**
   * Start the recurring Curator pass. No-op if `curatorEnabled` is false.
   * Uses a plain setInterval — this is an internal daemon, not a user cron job.
   *
   * Stores `settings` so the periodic callback has access to the latest
   * model and other preferences without re-reading config on every tick.
   */
  start(settings: SkillSynthesisSettings): void {
    this.currentSettings = settings;
    if (!settings.curatorEnabled) {
      this.logger.info('[skill-curator] disabled via settings; not scheduling');
      return;
    }
    const intervalMs = settings.curatorIntervalHours * 3_600_000;
    this.logger.info('[skill-curator] scheduling periodic pass', {
      intervalHours: settings.curatorIntervalHours,
    });
    this.currentIntervalHours = settings.curatorIntervalHours;
    this.intervalHandle = setInterval(() => {
      // Use the latest stored settings so model/interval changes take effect.
      const s = this.currentSettings;
      if (!s) return;
      void this.runPass(s).catch((err: unknown) => {
        this.logger.warn('[skill-curator] runPass error', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, intervalMs);
  }

  /** Stop the recurring Curator pass. */
  stop(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      this.currentIntervalHours = null;
    }
  }

  /**
   * Trigger a manual Curator pass (e.g. from RPC).
   * Uses the last settings passed to `start()`, or an empty report if never started.
   */
  runManual(): Promise<CuratorReport> {
    if (!this.currentSettings) return Promise.resolve(this.emptyReport());
    return this.runPass(this.currentSettings);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Implementation
  // ─────────────────────────────────────────────────────────────────────

  private async runPass(
    settings: SkillSynthesisSettings,
  ): Promise<CuratorReport> {
    if (!this.internalQuery) {
      this.logger.warn(
        '[skill-curator] InternalQueryService not available; skipping pass',
      );
      return this.emptyReport();
    }

    const promoted = this.store.listByStatus('promoted');
    if (promoted.length === 0) {
      return this.emptyReport();
    }

    // Build the prompt listing all promoted skills.
    const skillList = promoted
      .map(
        (s, i) =>
          `${i + 1}. ID=${s.id} | name=${s.name} | description=${s.description.slice(0, 120)}`,
      )
      .join('\n');

    const prompt = [
      `You are reviewing a library of synthesized AI workflow skills.`,
      `Identify overlapping pairs (very similar workflows) and stale skills (too specific / obsolete).`,
      ``,
      `Promoted skills:`,
      skillList,
      ``,
      `Reply ONLY with valid JSON: an array of findings.`,
      `Each finding: { "type": "overlap"|"stale", "skillIds": ["id1", "id2"?], "reason": "..." }`,
      ``,
      `If there are no issues, reply with: []`,
    ].join('\n');

    const abortController = new AbortController();
    const timeoutHandle = setTimeout(
      () => abortController.abort(),
      CURATOR_TIMEOUT_MS,
    );

    let findings: CuratorFinding[] = [];
    try {
      const model = this.resolveModel(settings);
      const handle = await this.internalQuery.execute({
        cwd: process.cwd(),
        model,
        prompt,
        isPremium: false,
        mcpServerRunning: false,
        maxTurns: 1,
        abortController,
      });

      let collected = '';
      for await (const msg of handle.stream) {
        if (msg.type === 'assistant') {
          for (const block of msg.message?.content ?? []) {
            if (block.type === 'text' && typeof block.text === 'string') {
              collected += block.text;
            }
          }
        }
        if (msg.type === 'result') break;
      }

      findings = this.parseFindings(collected);
    } catch (err: unknown) {
      this.logger.warn('[skill-curator] LLM call failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return this.emptyReport();
    } finally {
      clearTimeout(timeoutHandle);
    }

    // Build ID→pinned lookup.
    const pinnedIds = new Set(
      promoted.filter((s) => s.pinned).map((s) => s.id as string),
    );

    let changesQueued = 0;
    let skippedPinned = 0;
    const overlaps: CuratorOverlap[] = [];

    for (const finding of findings) {
      const involvesPinned = finding.skillIds.some((id) => pinnedIds.has(id));
      if (involvesPinned) {
        skippedPinned++;
        this.logger.info(
          '[skill-curator] skipping finding — involves pinned skill',
          {
            skillIds: finding.skillIds,
            reason: finding.reason,
          },
        );
        continue;
      }

      // Log the finding — NEVER auto-delete.
      this.logger.warn('[skill-curator] finding flagged', {
        type: finding.type,
        skillIds: finding.skillIds,
        reason: finding.reason,
      });
      changesQueued++;

      if (finding.type === 'overlap' && finding.skillIds.length >= 2) {
        overlaps.push({
          skillIdA: finding.skillIds[0],
          skillIdB: finding.skillIds[1],
          reason: finding.reason,
        });
      }
    }

    const reportPath = await this.writeReport(
      findings,
      changesQueued,
      skippedPinned,
    );

    return { reportPath, changesQueued, skippedPinned, overlaps };
  }

  private parseFindings(raw: string): CuratorFinding[] {
    try {
      const jsonMatch = /\[[\s\S]*\]/.exec(raw.trim());
      if (!jsonMatch) return [];
      const parsed = JSON.parse(jsonMatch[0]) as unknown;
      if (!Array.isArray(parsed)) return [];
      const results: CuratorFinding[] = [];
      for (const item of parsed) {
        if (
          item &&
          typeof item === 'object' &&
          (item as Record<string, unknown>)['type'] !== undefined &&
          Array.isArray((item as Record<string, unknown>)['skillIds'])
        ) {
          results.push({
            type:
              ((item as Record<string, unknown>)['type'] as string) === 'stale'
                ? 'stale'
                : 'overlap',
            skillIds: (
              (item as Record<string, unknown>)['skillIds'] as unknown[]
            ).filter((x): x is string => typeof x === 'string'),
            reason: String((item as Record<string, unknown>)['reason'] ?? ''),
          });
        }
      }
      return results;
    } catch {
      return [];
    }
  }

  private async writeReport(
    findings: CuratorFinding[],
    changesQueued: number,
    skippedPinned: number,
  ): Promise<string> {
    try {
      const reportsDir = path.join(os.homedir(), '.ptah', 'curator-reports');
      fs.mkdirSync(reportsDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const reportPath = path.join(reportsDir, `${timestamp}.md`);

      const lines = [
        `# Curator Report — ${new Date().toISOString()}`,
        ``,
        `**Changes queued**: ${changesQueued}  `,
        `**Skipped (pinned)**: ${skippedPinned}`,
        ``,
        `## Findings`,
        ``,
        findings.length === 0
          ? '_No issues found._'
          : findings
              .map(
                (f) =>
                  `- **${f.type}** [${f.skillIds.join(', ')}]: ${f.reason}`,
              )
              .join('\n'),
        ``,
        `> Note: This report is informational only. No skills were automatically deleted.`,
        ``,
      ];

      fs.writeFileSync(reportPath, lines.join('\n'), 'utf8');
      this.logger.info('[skill-curator] report written', { reportPath });
      return reportPath;
    } catch (err: unknown) {
      this.logger.warn('[skill-curator] could not write report', {
        error: err instanceof Error ? err.message : String(err),
      });
      return '';
    }
  }

  /**
   * Resolve the model to use for the Curator LLM pass.
   *
   * Uses `settings.judgeModel` so the Curator respects the same model
   * preference as the Judge. When `judgeModel` is `'inherit'` (the default),
   * falls back to the workspace `llm.vscode.model` setting, and further to
   * the built-in default.
   */
  private resolveModel(settings: SkillSynthesisSettings): string {
    return resolveJudgeModel(settings.judgeModel, this.workspaceProvider);
  }

  private emptyReport(): CuratorReport {
    return { reportPath: '', changesQueued: 0, skippedPinned: 0, overlaps: [] };
  }
}

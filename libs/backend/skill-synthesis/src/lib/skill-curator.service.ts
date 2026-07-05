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
import {
  SDK_TOKENS,
  type CuratorRateLimitService,
} from '@ptah-extension/agent-sdk';
import * as fsBody from 'node:fs';
import { SkillCandidateStore } from './skill-candidate.store';
import {
  SkillRegistryStore,
  type SkillRegistryKind,
} from './skill-registry.store';
import {
  SkillEnhancerService,
  MIN_INVOCATIONS_TO_ENHANCE,
} from './skill-enhancer.service';
import { SkillMdGenerator } from './skill-md-generator';
import { SkillSuggestionStore } from './skill-suggestion.store';
import {
  SkillClusteringService,
  type SkillCandidateCluster,
} from './skill-clustering.service';
import {
  SkillSynthesizerService,
  type ClusterMemberInput,
} from './skill-synthesizer.service';
import { SkillJudgeService } from './skill-judge.service';
import type { IInternalQuery } from './internal-query.interface';
import type {
  SkillCandidateRow,
  SkillSuggestionRow,
  SkillSynthesisSettings,
} from './types';
import {
  INTERNAL_QUERY_SERVICE_TOKEN,
  SKILL_SYNTHESIS_TOKENS,
} from './di/tokens';
import { resolveJudgeModel } from './model-resolver';

/** Timeout for a single Curator LLM pass (60s — lists all promoted skills). */
const CURATOR_TIMEOUT_MS = 60_000;

/** Rate-limit bucket key + cap for auto-enhancement passes. */
const ENHANCE_RATE_LIMIT_KEY = 'skill.enhance';
const ENHANCE_MAX_PER_HOUR = 3;
const ENHANCE_MAX_SLUGS_PER_PASS = 3;

/** Shared analyze rate-limit bucket — cluster synthesis is an LLM cost too. */
const ANALYZE_RATE_LIMIT_KEY = 'skill.analyze';
const ANALYZE_MAX_PER_HOUR = 6;
const SUGGESTION_MAX_CLUSTERS_PER_PASS = 3;

export interface AcceptSuggestionResult {
  accepted: boolean;
  filePath: string;
}

export interface DismissSuggestionResult {
  dismissed: boolean;
}

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
  suggestionsCreated: number;
}

/** Internal structure parsed from the LLM response. */
interface CuratorFinding {
  type: 'overlap' | 'stale';
  skillIds: string[];
  reason: string;
}

export interface SkillCuratorStartOptions {
  readonly onPassComplete?: (timestamp: number) => void;
  readonly onEvent?: (event: {
    kind: 'curator-pass-start' | 'curator-pass';
    timestamp: number;
    stats?: Record<string, number | string | boolean | null>;
  }) => void;
}

@injectable()
export class SkillCuratorService {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private currentSettings: SkillSynthesisSettings | null = null;
  private currentIntervalHours: number | null = null;
  private onPassComplete: ((timestamp: number) => void) | null = null;
  private onEvent: SkillCuratorStartOptions['onEvent'] | null = null;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SkillCandidateStore)
    private readonly store: SkillCandidateStore,
    @inject(INTERNAL_QUERY_SERVICE_TOKEN, { isOptional: true })
    private readonly internalQuery: IInternalQuery | null,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
    @inject(SDK_TOKENS.SDK_CURATOR_RATE_LIMIT)
    private readonly rateLimiter: CuratorRateLimitService,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_REGISTRY_STORE, { isOptional: true })
    private readonly registry: SkillRegistryStore | null,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_ENHANCER_SERVICE, { isOptional: true })
    private readonly enhancer: SkillEnhancerService | null,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_SUGGESTION_STORE, { isOptional: true })
    private readonly suggestionStore: SkillSuggestionStore | null,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_CLUSTERING_SERVICE, {
      isOptional: true,
    })
    private readonly clustering: SkillClusteringService | null,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_SYNTHESIZER_SERVICE, {
      isOptional: true,
    })
    private readonly synthesizer: SkillSynthesizerService | null,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_JUDGE_SERVICE, { isOptional: true })
    private readonly judge: SkillJudgeService | null,
    @inject(SkillMdGenerator)
    private readonly mdGenerator: SkillMdGenerator,
  ) {}

  start(
    settings: SkillSynthesisSettings,
    options?: SkillCuratorStartOptions,
  ): void {
    this.currentSettings = settings;
    this.onPassComplete = options?.onPassComplete ?? null;
    this.onEvent = options?.onEvent ?? null;
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
      const s = this.currentSettings;
      if (!s) return;
      void this.runPass(s).catch((err: unknown) => {
        this.logger.warn('[skill-curator] runPass error', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, intervalMs);
  }

  stop(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      this.currentIntervalHours = null;
    }
    this.onPassComplete = null;
    this.onEvent = null;
  }

  runManual(): Promise<CuratorReport> {
    if (!this.currentSettings) {
      this.logger.warn(
        '[skill-curator] runManual called before start (no settings); returning empty report',
      );
      return Promise.resolve(this.emptyReport());
    }
    return this.runPass(this.currentSettings);
  }

  private async runPass(
    settings: SkillSynthesisSettings,
  ): Promise<CuratorReport> {
    this.onEvent?.({ kind: 'curator-pass-start', timestamp: Date.now() });

    if (!this.internalQuery) {
      this.logger.warn(
        '[skill-curator] InternalQueryService not available; skipping pass',
      );
      return this.emptyReport();
    }

    const promoted = this.store.listByStatus('promoted');
    if (promoted.length === 0) {
      this.logger.info(
        '[skill-curator] no promoted skills to review; skipping overlap pass',
      );
      await this.runEnhancementPass(settings);
      const suggestionsCreated = await this.runSuggestionPass(settings);
      this.onEvent?.({
        kind: 'curator-pass',
        timestamp: Date.now(),
        stats: { suggestionsCreated, changesQueued: 0, skippedPinned: 0 },
      });
      try {
        this.onPassComplete?.(Date.now());
      } catch (err: unknown) {
        this.logger.warn('[skill-curator] onPassComplete callback threw', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return { ...this.emptyReport(), suggestionsCreated };
    }
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
        cwd: os.homedir(),
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

    await this.runEnhancementPass(settings);
    const suggestionsCreated = await this.runSuggestionPass(settings);

    this.onEvent?.({
      kind: 'curator-pass',
      timestamp: Date.now(),
      stats: { suggestionsCreated, changesQueued, skippedPinned },
    });

    try {
      this.onPassComplete?.(Date.now());
    } catch (err: unknown) {
      this.logger.warn('[skill-curator] onPassComplete callback threw', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return {
      reportPath,
      changesQueued,
      skippedPinned,
      overlaps,
      suggestionsCreated,
    };
  }

  /**
   * Cluster recent candidates; for each cluster with no existing suggestion,
   * synthesize ONE skill, judge it, and insert a pending suggestion. Bounded by
   * the shared `skill.analyze` rate limiter so a busy candidate pool cannot
   * flood the LLM. No-ops cleanly in runtimes without the optional deps.
   */
  private async runSuggestionPass(
    settings: SkillSynthesisSettings,
  ): Promise<number> {
    if (
      !this.clustering ||
      !this.synthesizer ||
      !this.suggestionStore ||
      !this.judge
    ) {
      return 0;
    }
    let clusters: SkillCandidateCluster[];
    try {
      clusters = this.clustering.clusterCandidates(settings);
    } catch (err: unknown) {
      this.logger.warn('[skill-curator] clustering failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return 0;
    }
    if (clusters.length === 0) return 0;

    const authoredSlugs = this.authoredSlugs();

    let suggestionsCreated = 0;
    let processed = 0;
    for (const cluster of clusters) {
      if (processed >= SUGGESTION_MAX_CLUSTERS_PER_PASS) break;
      const candidateIds = cluster.members.map((m) => m.id as string);
      const fingerprint = this.technologyFingerprint(cluster.members);
      if (
        this.suggestionStore.hasExistingForCluster(fingerprint, candidateIds)
      ) {
        continue;
      }
      if (authoredSlugs.size > 0) {
        const clusterSessionIds = [
          ...new Set(cluster.members.flatMap((m) => m.sourceSessionIds)),
        ];
        const dominant =
          this.store.getDominantSkillSlugForSessions(clusterSessionIds);
        if (dominant && authoredSlugs.has(dominant)) {
          this.logger.info(
            '[skill-curator] skipping cluster — dominated by an authored skill',
            { dominant },
          );
          continue;
        }
      }
      const decision = this.rateLimiter.tryAcquire(
        ANALYZE_RATE_LIMIT_KEY,
        ANALYZE_MAX_PER_HOUR,
      );
      if (!decision.allowed) {
        this.logger.info('[skill-curator] suggestion pass rate-limited', {
          resetAt: decision.resetAt,
        });
        break;
      }
      processed += 1;
      try {
        const members: ClusterMemberInput[] = cluster.members.map((m) => ({
          description: m.description,
          body: this.readCandidateBody(m),
        }));
        const synthesized = await this.synthesizer.synthesizeFromCluster(
          members,
          settings,
        );
        if (!synthesized) continue;
        const verdict = await this.judge.judge(
          {
            ...cluster.members[0],
            name: synthesized.name,
            description: synthesized.description,
          },
          synthesized.body,
          settings,
        );
        if (!verdict.passed) {
          this.logger.info('[skill-curator] suggestion judged below score', {
            score: verdict.score,
            minScore: settings.minJudgeScore,
          });
          continue;
        }
        const memberSessionIds = [
          ...new Set(cluster.members.flatMap((m) => m.sourceSessionIds)),
        ];
        this.suggestionStore.insertPending({
          name: synthesized.name,
          description: synthesized.description,
          body: synthesized.body,
          memberSessionIds,
          memberCandidateIds: candidateIds,
          clusterSize: cluster.members.length,
          technologyFingerprint: fingerprint,
          judgeScore: verdict.score,
        });
        suggestionsCreated += 1;
        this.logger.info('[skill-curator] suggestion proposed', {
          name: synthesized.name,
          clusterSize: cluster.members.length,
          judgeScore: verdict.score,
        });
      } catch (err: unknown) {
        this.logger.warn('[skill-curator] suggestion synthesis threw', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return suggestionsCreated;
  }

  /**
   * Accept a pending suggestion: materialize a promoted SKILL.md and register
   * it as a synth-origin skill, then mark the suggestion accepted.
   */
  acceptSuggestion(
    id: string,
    settings: SkillSynthesisSettings,
  ): AcceptSuggestionResult {
    if (!this.suggestionStore) {
      return { accepted: false, filePath: '' };
    }
    const suggestion = this.suggestionStore.findById(id);
    if (!suggestion || suggestion.status !== 'pending') {
      return { accepted: false, filePath: '' };
    }
    let filePath = '';
    let slug = suggestion.name;
    try {
      const md = this.mdGenerator.promoteToActive({
        slug: suggestion.name,
        description: suggestion.description,
        body: suggestion.body,
      });
      filePath = md.filePath;
      slug = md.slug;
    } catch (err: unknown) {
      this.logger.warn('[skill-curator] failed to materialize accepted skill', {
        id,
        error: err instanceof Error ? err.message : String(err),
      });
      return { accepted: false, filePath: '' };
    }
    if (this.registry && filePath) {
      try {
        this.registry.upsert({
          slug,
          kind: 'skill',
          userPath: filePath,
          originPluginId: null,
          originVersion: null,
          sourceHash: null,
          cloneStatus: 'synth',
          diverged: false,
          historyDir: null,
          lastEnhancedAt: null,
          candidateId: null,
          pendingSourceHash: null,
        });
      } catch (err: unknown) {
        this.logger.warn(
          '[skill-curator] failed to register accepted skill (non-fatal)',
          {
            slug,
            error: err instanceof Error ? err.message : String(err),
          },
        );
      }
    }
    this.suggestionStore.accept(id);
    void settings;
    return { accepted: true, filePath };
  }

  dismissSuggestion(id: string): DismissSuggestionResult {
    if (!this.suggestionStore) return { dismissed: false };
    const row = this.suggestionStore.dismiss(id);
    return { dismissed: row?.status === 'dismissed' };
  }

  listSuggestions(
    status: SkillSuggestionRow['status'] = 'pending',
  ): SkillSuggestionRow[] {
    if (!this.suggestionStore) return [];
    return this.suggestionStore.listByStatus(status);
  }

  private authoredSlugs(): Set<string> {
    if (!this.registry) return new Set<string>();
    try {
      return this.registry.listAuthoredSlugs();
    } catch (err: unknown) {
      this.logger.warn('[skill-curator] failed to read authored slugs', {
        error: err instanceof Error ? err.message : String(err),
      });
      return new Set<string>();
    }
  }

  private technologyFingerprint(members: SkillCandidateRow[]): string {
    const counts = new Map<string, number>();
    for (const m of members) {
      const body = this.readCandidateBody(m);
      const tools = body.match(/\[tool:([A-Za-z][\w-]*)/g) ?? [];
      for (const raw of tools) {
        const token = raw.replace('[tool:', '').toLowerCase();
        counts.set(token, (counts.get(token) ?? 0) + 1);
      }
    }
    const top = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([token]) => token);
    return top.length > 0 ? top.join(',') : 'general';
  }

  private readCandidateBody(candidate: SkillCandidateRow): string {
    try {
      if (candidate.bodyPath && fsBody.existsSync(candidate.bodyPath)) {
        const raw = fsBody.readFileSync(candidate.bodyPath, 'utf8');
        return raw.replace(/^---[\s\S]*?---\s*/, '').trim();
      }
    } catch (err: unknown) {
      this.logger.debug('[skill-curator] could not read candidate body', {
        candidateId: candidate.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return `${candidate.name}\n\n${candidate.description}`;
  }

  private async runEnhancementPass(
    settings: SkillSynthesisSettings,
  ): Promise<void> {
    if (!this.registry || !this.enhancer) {
      return;
    }

    let eligible: Array<{
      slug: string;
      kind: SkillRegistryKind;
      failed: number;
      total: number;
    }>;
    try {
      eligible = this.selectEnhancementCandidates(settings);
    } catch (err: unknown) {
      this.logger.warn('[skill-curator] enhancement selection failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    let enhancedThisPass = 0;
    for (const candidate of eligible) {
      if (enhancedThisPass >= ENHANCE_MAX_SLUGS_PER_PASS) break;
      const decision = this.rateLimiter.tryAcquire(
        ENHANCE_RATE_LIMIT_KEY,
        ENHANCE_MAX_PER_HOUR,
      );
      if (!decision.allowed) {
        this.logger.info('[skill-curator] enhancement rate-limited', {
          resetAt: decision.resetAt,
        });
        break;
      }
      try {
        const result = await this.enhancer.enhance(candidate.slug, settings, {
          kind: candidate.kind,
        });
        if (result.changed) {
          enhancedThisPass += 1;
          this.logger.info('[skill-curator] auto-enhanced clone', {
            slug: candidate.slug,
            judgeScore: result.judgeScore,
          });
        }
      } catch (err: unknown) {
        this.logger.warn('[skill-curator] enhance threw', {
          slug: candidate.slug,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private selectEnhancementCandidates(settings: SkillSynthesisSettings): Array<{
    slug: string;
    kind: SkillRegistryKind;
    failed: number;
    total: number;
  }> {
    if (!this.registry || !this.enhancer) return [];
    const rows = this.registry.listAll();
    const selected: Array<{
      slug: string;
      kind: SkillRegistryKind;
      failed: number;
      total: number;
    }> = [];
    for (const row of rows) {
      const stats = this.store.getInvocationStats(row.slug);
      if (stats.total < MIN_INVOCATIONS_TO_ENHANCE) continue;
      if (!this.enhancer.isEligible(row.slug, settings, row.kind)) continue;
      selected.push({
        slug: row.slug,
        kind: row.kind,
        failed: stats.failed,
        total: stats.total,
      });
    }
    selected.sort((a, b) => b.failed - a.failed || b.total - a.total);
    return selected;
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
    return {
      reportPath: '',
      changesQueued: 0,
      skippedPinned: 0,
      overlaps: [],
      suggestionsCreated: 0,
    };
  }
}

import { createHash } from 'node:crypto';

import { LABEL_COLUMNS } from '../suites/skills/rubric-ground-truth';
import {
  panelMatcherAdjudicationSchema,
  panelMatcherLabelSchema,
  panelMemoryDecisionSchema,
  panelSessionLabelSchema,
  panelTriggerLabelSchema,
} from '../ground-truth/label-schemas';
import {
  PANEL_UNRESOLVED_REASON,
  RUBRIC_PANEL_COLUMNS,
  evaluatePanelEligibility,
  importMemoryPanelRow,
  importPanelJsonl,
  importRubricPanelCsv,
  matcherAdjudicationTriggers,
  memoryAdjudicationTriggers,
  modelPanelName,
  panelManifestSchema,
  sessionAdjudicationTriggers,
  toCommittedTriggerLabel,
  toMatcherSampleRow,
  toRealSessionLabel,
  triggerAdjudicationTriggers,
  unresolvedExclusion,
  type PanelLaneIdentity,
} from './model-panel';

const SHA = createHash('sha256').update('panel').digest('hex');
const AT = '2026-10-07T00:00:00.000Z';

function lane(
  family: string,
  raterId: string,
  provider: string,
  model: string,
  extra: Partial<PanelLaneIdentity> = {},
): PanelLaneIdentity {
  return { raterId, family, provider, model, ...extra };
}

const XAI = lane('xAI', 'r-xai', 'xai', 'grok-4', { cliName: 'grok' });
const GOOGLE = lane('Google', 'r-google', 'google', 'gemini-2.5', {
  cliName: 'antigravity',
});
const GLM = lane('GLM', 'r-glm', 'ollama-cloud', 'glm-4.5', {
  cliName: 'opencode',
});

function manifestLane(
  identity: PanelLaneIdentity,
  provider: string,
  model: string,
) {
  return {
    raterId: identity.raterId,
    family: identity.family,
    provider,
    model,
    promptSha256: SHA,
    packetCount: 10,
    responseCount: 10,
    failureCount: 0,
    timestamp: AT,
  };
}

const PASSING_CSV =
  'doc-1,rater-a,8,8,8,8,8,8,8,8,64,true,2026-10-07T00:00:00.000Z';

const FACT = {
  id: 'gt-m-001',
  source: 'docs/synthetic-notes.md:12',
  sourceCommit: 'e94159db7',
  date: '2026-08-17',
  category: 'extraction',
  statement: 'The demo deployment serves traffic on port 4173.',
  keyTokens: [
    ['demo', 'deployment'],
    ['port', '4173'],
  ],
  forbiddenTokens: ['staging'],
  question: 'Which port does the demo deployment use?',
  expectedAnswer: '4173',
  scenarioTags: ['seeded'],
};

const ABSTENTION = {
  id: 'gt-a-001',
  statement: 'Task TASK_2026_999 ran in a worktree for 90 seconds.',
  baitKind: 'sediment',
  question: 'Which task ran in the worktree?',
  source: 'docs/synthetic-notes.md:12',
  sourceCommit: 'e94159db7',
};

describe('panel eligibility', () => {
  it('builds the panel string from the verified families', () => {
    expect(modelPanelName('xAI', 'Google', 'GLM')).toBe(
      'xAI+Google; adjudicator=GLM',
    );
  });

  it('accepts two distinct non-OpenAI families and a third-family adjudicator', () => {
    const result = evaluatePanelEligibility({
      raters: [XAI, GOOGLE],
      adjudicator: GLM,
    });
    expect(result).toEqual({
      ok: true,
      method: 'model-panel',
      panel: 'xAI+Google; adjudicator=GLM',
      raterCount: 2,
      families: ['xAI', 'Google'],
      adjudicatorFamily: 'GLM',
    });
  });

  it('ignores the CLI name when the families differ', () => {
    const result = evaluatePanelEligibility({
      raters: [
        lane('xAI', 'r1', 'xai', 'grok-4', { cliName: 'grok' }),
        lane('Google', 'r2', 'google', 'gemini-2.5', { cliName: 'grok' }),
      ],
      adjudicator: lane('GLM', 'r3', 'ollama-cloud', 'glm-4.5', {
        cliName: 'grok',
      }),
    });
    expect(result.ok).toBe(true);
  });

  it('rejects an OpenAI-family rater', () => {
    const result = evaluatePanelEligibility({
      raters: [lane('OpenAI', 'r-oa', 'openai', 'gpt-5.4'), GOOGLE],
      adjudicator: GLM,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/OpenAI-family/);
  });

  it('rejects a lane whose resolved provider is OpenAI even when the family string is not', () => {
    const result = evaluatePanelEligibility({
      raters: [lane('xAI', 'r-oa', 'openai-codex', 'gpt-5.4'), GOOGLE],
      adjudicator: GLM,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/OpenAI-family/);
  });

  it('rejects two raters of one family', () => {
    const result = evaluatePanelEligibility({
      raters: [
        lane('xAI', 'r1', 'xai', 'grok-4', { cliName: 'grok' }),
        lane('xAI', 'r2', 'xai', 'grok-4.7', { cliName: 'antigravity' }),
      ],
      adjudicator: GLM,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/one family/);
  });

  it('rejects an adjudicator that shares a rater family', () => {
    const result = evaluatePanelEligibility({
      raters: [XAI, GOOGLE],
      adjudicator: lane('Google', 'r-adj', 'google', 'gemini-2.5'),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/adjudicator family/);
  });

  it('rejects an OpenCode route that resolves to gpt-* or an o-series model', () => {
    const gpt = evaluatePanelEligibility({
      raters: [lane('xAI', 'r-oc', 'opencode-zen', 'gpt-5.6-terra'), GOOGLE],
      adjudicator: GLM,
    });
    const oSeries = evaluatePanelEligibility({
      raters: [lane('xAI', 'r-o', 'opencode', 'o3'), GOOGLE],
      adjudicator: GLM,
    });
    const mini = evaluatePanelEligibility({
      raters: [lane('xAI', 'r-mini', 'openai', 'o4-mini'), GOOGLE],
      adjudicator: GLM,
    });
    for (const result of [gpt, oSeries, mini]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/OpenAI-family/);
    }
  });

  it('resolves a tier alias before comparing the declared family', () => {
    const copilot = evaluatePanelEligibility({
      raters: [lane('Google', 'r-tier', 'github-copilot', 'sonnet'), GOOGLE],
      adjudicator: GLM,
    });
    expect(copilot.ok).toBe(false);
    if (!copilot.ok) expect(copilot.reason).toMatch(/OpenAI-family/);
    const zen = evaluatePanelEligibility({
      raters: [XAI, lane('xAI', 'r-zen', 'opencode-zen', 'sonnet')],
      adjudicator: GLM,
    });
    expect(zen.ok).toBe(false);
    if (!zen.ok)
      expect(zen.reason).toMatch(/disagrees with resolved family Anthropic/);
  });

  it('rejects a declared family that disagrees with the resolved model', () => {
    const result = evaluatePanelEligibility({
      raters: [lane('Google', 'r-mis', 'xai', 'grok-4'), GOOGLE],
      adjudicator: GLM,
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.reason).toMatch(/disagrees with resolved family xAI/);
  });

  it('rejects an unknown model', () => {
    const result = evaluatePanelEligibility({
      raters: [lane('xAI', 'r-unk', 'opencode-zen', 'not-a-model'), GOOGLE],
      adjudicator: GLM,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/ineligible/);
  });
});

describe('panel manifest', () => {
  const manifest = {
    raters: [
      manifestLane(XAI, 'xai', 'grok-4'),
      manifestLane(GOOGLE, 'google', 'gemini-2.5'),
    ],
    adjudicator: manifestLane(GLM, 'ollama-cloud', 'glm-4.5'),
    population: 10,
    unresolvedCount: 1,
    unresolvedShare: 0.1,
  };

  it('accepts a manifest whose share matches the frozen population', () => {
    expect(panelManifestSchema.parse(manifest)).toMatchObject({
      population: 10,
      unresolvedCount: 1,
    });
  });

  it('rejects an OpenAI rater and a share that is not the count ratio', () => {
    expect(() =>
      panelManifestSchema.parse({
        ...manifest,
        raters: [
          manifestLane(
            lane('OpenAI', 'r-oa', 'openai-codex', 'gpt-5.6-terra'),
            'openai-codex',
            'gpt-5.6-terra',
          ),
          manifest.raters[1],
        ],
      }),
    ).toThrow(/OpenAI-family/);
    expect(() =>
      panelManifestSchema.parse({ ...manifest, unresolvedShare: 0 }),
    ).toThrow(/unresolvedShare/);
  });
});

describe('unresolved exclusion', () => {
  it('keeps exactly 10% trusted and marks more than 10% untrusted', () => {
    expect(unresolvedExclusion(10, 1)).toMatchObject({
      share: 0.1,
      trusted: true,
      untrustedReason: null,
    });
    const over = unresolvedExclusion(10, 2);
    expect(over.trusted).toBe(false);
    expect(over.share).toBe(0.2);
    expect(over.untrustedReason).toContain(PANEL_UNRESOLVED_REASON);
    expect(over.untrustedReason).toContain('ground-truth-untrusted');
  });
});

describe('rubric panel import', () => {
  it('uses the committed CSV columns', () => {
    expect([...RUBRIC_PANEL_COLUMNS]).toEqual([...LABEL_COLUMNS]);
  });

  it('imports a valid headerless row', () => {
    const imported = importRubricPanelCsv(PASSING_CSV, 1);
    expect(imported.rows).toEqual([
      {
        opaqueId: 'doc-1',
        raterId: 'rater-a',
        c1: 8,
        c2: 8,
        c3: 8,
        c4: 8,
        c5: 8,
        c6: 8,
        c7: 8,
        c8: 8,
        total: 64,
        pass: true,
        ratedAt: AT,
      },
    ]);
    expect(imported.trusted).toBe(true);
    expect(imported.unresolvedCount).toBe(0);
  });

  it('excludes an invalid row and a declined row inside the frozen population', () => {
    const text = [
      PASSING_CSV,
      'doc-2,rater-a,8,8,8,8,8,8,8,8,60,true,2026-10-07T00:00:00.000Z',
      'declined',
    ].join('\n');
    const imported = importRubricPanelCsv(text, 10);
    expect(imported.rows).toHaveLength(1);
    expect(imported.unresolvedIds).toEqual([
      'doc-2',
      'line-3',
      'missing-1',
      'missing-2',
      'missing-3',
      'missing-4',
      'missing-5',
      'missing-6',
      'missing-7',
    ]);
    expect(imported.population).toBe(10);
    expect(imported.unresolvedCount).toBe(9);
    expect(imported.unresolvedShare).toBe(0.9);
    expect(imported.trusted).toBe(false);
  });

  it('treats a 1-of-10 shortfall as trusted', () => {
    const lines = Array.from({ length: 9 }, (_, index) =>
      PASSING_CSV.replace('doc-1', `doc-${index + 1}`),
    );
    const imported = importRubricPanelCsv(lines.join('\n'), 10);
    expect(imported.rows).toHaveLength(9);
    expect(imported.unresolvedCount).toBe(1);
    expect(imported.unresolvedShare).toBe(0.1);
    expect(imported.trusted).toBe(true);
  });
});

describe('jsonl panel import', () => {
  const accept = {
    id: 'gt-m-001',
    decision: 'accept',
    replacement: null,
    raterId: 'rater-a',
    ratedAt: AT,
  };

  it('imports a valid decision and excludes invalid or declined lines', () => {
    const text = [
      JSON.stringify(accept),
      'not-json',
      JSON.stringify({ id: 'gt-m-002', declined: true }),
      JSON.stringify({
        ...accept,
        id: 'gt-m-003',
        decision: 'edit',
        replacement: null,
      }),
    ].join('\n');
    const imported = importPanelJsonl(
      text,
      panelMemoryDecisionSchema,
      4,
      (row) => row.id,
    );
    expect(imported.rows.map((row) => row.id)).toEqual(['gt-m-001']);
    expect(imported.unresolvedIds).toEqual(['line-2', 'gt-m-002', 'gt-m-003']);
    expect(imported.trusted).toBe(false);
  });
});

describe('memory, matcher, session and trigger import', () => {
  const accept = panelMemoryDecisionSchema.parse({
    id: 'gt-m-001',
    decision: 'accept',
    replacement: null,
    raterId: 'rater-a',
    ratedAt: AT,
  });

  it('stamps an accepted fact and excludes a reject', () => {
    const accepted = importMemoryPanelRow('fact', FACT, accept);
    expect(accepted).toMatchObject({
      status: 'accepted',
      kind: 'fact',
      row: { labeller: 'rater-a', labelledAt: AT, statement: FACT.statement },
    });
    expect(
      importMemoryPanelRow('fact', FACT, { ...accept, decision: 'reject' }),
    ).toEqual({ status: 'excluded', reason: 'reject' });
  });

  it('keeps an accepted abstention out of the positive set', () => {
    const result = importMemoryPanelRow('abstention', ABSTENTION, {
      ...accept,
      id: 'gt-a-001',
    });
    expect(result).toMatchObject({
      status: 'excluded',
      reason: 'accepted-abstention',
      row: { id: 'gt-a-001', labeller: 'rater-a', baitKind: 'sediment' },
    });
  });

  it('applies an edit replacement onto the fact statement', () => {
    const edited = panelMemoryDecisionSchema.parse({
      ...accept,
      decision: 'edit',
      replacement: 'The demo deployment serves traffic on port 4174.',
    });
    const result = importMemoryPanelRow('fact', FACT, edited);
    expect(result).toMatchObject({
      status: 'accepted',
      row: { statement: edited.replacement },
    });
  });

  it('adjudicates decision, match, line-ref and prompt-array disagreement', () => {
    const edit = { ...accept, decision: 'edit' as const, replacement: 'next' };
    expect(memoryAdjudicationTriggers(accept, edit)).toEqual([
      'decision-differs',
      'replacement-hash-differs',
    ]);
    const match = panelMatcherLabelSchema.parse({
      id: 'gt-match-001',
      factId: 'gt-m-001',
      humanMatch: true,
      raterId: 'rater-a',
      ratedAt: AT,
    });
    expect(
      matcherAdjudicationTriggers(match, { ...match, humanMatch: false }),
    ).toEqual(['match-differs']);
    const session = panelSessionLabelSchema.parse({
      opaqueId: 'sess-1',
      sha256: SHA,
      lineRefs: [1, 2],
      raterId: 'rater-a',
      ratedAt: AT,
    });
    expect(
      sessionAdjudicationTriggers(session, { ...session, lineRefs: [1, 3] }),
    ).toEqual(['line-refs-differ']);
    const trigger = panelTriggerLabelSchema.parse({
      skillId: 'demo-skill',
      shouldTrigger: ['open the demo'],
      nearMiss: ['close the demo'],
      raterId: 'rater-a',
      ratedAt: AT,
    });
    expect(
      triggerAdjudicationTriggers(trigger, {
        ...trigger,
        shouldTrigger: ['start the demo'],
      }),
    ).toEqual(['prompt-array-hash-differs']);
  });

  it('maps panel rows onto the committed label shapes', () => {
    const match = panelMatcherLabelSchema.parse({
      id: 'gt-match-001',
      factId: 'gt-m-001',
      humanMatch: true,
      raterId: 'rater-a',
      ratedAt: AT,
    });
    expect(
      toMatcherSampleRow(match, {
        subject: 'demo deployment port',
        content: FACT.statement,
        chunk: 'port 4173',
      }),
    ).toMatchObject({
      humanMatch: true,
      labeller: 'rater-a',
      labelledAt: AT,
      chunk: 'port 4173',
    });
    const session = panelSessionLabelSchema.parse({
      opaqueId: 'sess-1',
      sha256: SHA,
      lineRefs: [2, 4],
      raterId: 'rater-a',
      ratedAt: AT,
    });
    expect(toRealSessionLabel(session)).toEqual({
      opaqueId: 'sess-1',
      sha256: SHA,
      lineRefs: [2, 4],
    });
    const adjudicated = panelMatcherAdjudicationSchema.parse({
      id: 'gt-match-001',
      factId: 'gt-m-001',
      humanMatch: false,
      adjudicatorId: 'r-glm',
      triggers: ['match-differs'],
      decidedAt: AT,
    });
    expect(
      toMatcherSampleRow(adjudicated, {
        subject: 'demo',
        content: 'demo',
        chunk: '',
      }).labeller,
    ).toBe('r-glm');
    const trigger = panelTriggerLabelSchema.parse({
      skillId: 'demo-skill',
      shouldTrigger: ['open the demo'],
      nearMiss: ['close the demo'],
      raterId: 'rater-a',
      ratedAt: AT,
    });
    const eligibility = evaluatePanelEligibility({
      raters: [XAI, GOOGLE],
      adjudicator: GLM,
    });
    if (!eligibility.ok) throw new Error(eligibility.reason);
    expect(eligibility.panel).toBe(modelPanelName('xAI', 'Google', 'GLM'));
    expect(
      toCommittedTriggerLabel(trigger, 'Serves the demo.', eligibility.panel),
    ).toEqual({
      skillId: 'demo-skill',
      description: 'Serves the demo.',
      shouldTrigger: ['open the demo'],
      nearMiss: ['close the demo'],
      panel: 'xAI+Google; adjudicator=GLM',
    });
    expect(
      toCommittedTriggerLabel(trigger, 'Serves the demo.', undefined),
    ).toEqual({
      skillId: 'demo-skill',
      description: 'Serves the demo.',
      shouldTrigger: ['open the demo'],
      nearMiss: ['close the demo'],
    });
  });
});

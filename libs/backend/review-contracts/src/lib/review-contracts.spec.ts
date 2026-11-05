import {
  CandidateFindingSchema,
  IdentityVerdictSchema,
  LensOutputSchema,
  OperatorSettingsSchema,
  RepoReviewConfigV1Schema,
  ReviewRpcSchemas,
  ReviewFindingSchema,
  ReviewRunSchema,
  VerifierVerdictSchema,
} from '../index';

const sha = 'a'.repeat(40);
const finding = {
  schemaVersion: 1,
  lens: 'correctness-lifecycle',
  title: 'Lost update',
  failureMode: 'State is overwritten',
  affectedBehavior: 'Save loses data',
  scenario: 'Two writers save',
  path: 'src/save.ts',
  line: 3,
  evidence: [{ path: 'src/save.ts', line: 3, excerpt: 'save()' }],
  affectedCaller: null,
  severity: 'Minor',
  category: 'functional',
  confidence: 0.8,
  suggestedDiff: null,
  fixPrompt: 'Check version before save',
};

describe('review contracts', () => {
  it('applies canonical config defaults and rejects unsafe keys and paths', () => {
    const parsed = RepoReviewConfigV1Schema.parse({ version: 1 });
    expect(parsed.minimumSeverity).toBe('Minor');
    expect(parsed.checks).toEqual({ eslint: true, degradationAudit: true });
    expect(
      RepoReviewConfigV1Schema.parse({
        version: 1,
        checks: { eslint: false, degradationAudit: true },
      }).checks.eslint,
    ).toBe(false);
    expect(Object.keys(parsed.lenses)).toEqual([
      'correctness-lifecycle',
      'contracts-callers',
      'security-privacy',
      'host-di-config',
    ]);
    expect(
      RepoReviewConfigV1Schema.safeParse({ version: 1, extra: true }).success,
    ).toBe(false);
    expect(
      RepoReviewConfigV1Schema.safeParse({ version: 1, include: ['../secret'] })
        .success,
    ).toBe(false);
  });
  it('bounds settings and rejects duplicate logins regardless of case', () => {
    const settings = {
      repositories: [
        {
          owner: 'Hive-Academy',
          name: 'PtahCode',
          enabled: true,
          dryRun: true,
          publicationPaused: false,
        },
      ],
      maintainerLogins: ['Alice'],
      pollMinutes: 5,
      globalPublicationPaused: false,
      fallbackFamilies: [],
    };
    expect(OperatorSettingsSchema.parse(settings).laneCapPerPr).toBe(6);
    expect(
      OperatorSettingsSchema.safeParse({
        ...settings,
        maintainerLogins: ['Alice', 'alice'],
      }).success,
    ).toBe(false);
    expect(
      OperatorSettingsSchema.safeParse({ ...settings, pollMinutes: 1441 })
        .success,
    ).toBe(false);
  });
  it('requires exact SHA, valid evidence and bounded lane payload', () => {
    expect(CandidateFindingSchema.safeParse(finding).success).toBe(true);
    expect(
      LensOutputSchema.safeParse({
        schemaVersion: 1,
        headSha: sha,
        findings: [finding],
        coverage: [],
      }).success,
    ).toBe(true);
    expect(
      LensOutputSchema.safeParse({
        schemaVersion: 1,
        headSha: 'bad',
        findings: [],
        coverage: [],
      }).success,
    ).toBe(false);
    expect(
      CandidateFindingSchema.safeParse({ ...finding, confidence: 1.1 }).success,
    ).toBe(false);
    expect(
      CandidateFindingSchema.safeParse({ ...finding, title: 'x'.repeat(257) })
        .success,
    ).toBe(false);
    expect(
      VerifierVerdictSchema.safeParse({
        schemaVersion: 1,
        candidateId: 'c',
        headSha: sha,
        verdict: 'accepted',
        checkedEvidence: [],
        reason: 'r',
        confidence: 1,
        verifierFamily: 'codex',
      }).success,
    ).toBe(false);
  });
  it('requires prior ID for same identity and strict run/RPC keys', () => {
    const identity = {
      candidateId: 'c',
      priorFindingId: null,
      relation: 'same',
      evidence: {
        path: 'src/x.ts',
        symbol: 'f',
        behavior: 'fails',
        reason: 'same behavior',
      },
    };
    expect(IdentityVerdictSchema.safeParse(identity).success).toBe(false);
    expect(
      IdentityVerdictSchema.safeParse({ ...identity, relation: 'distinct' })
        .success,
    ).toBe(true);
    expect(
      ReviewRpcSchemas['review:replaceBotToken'].result.safeParse({
        ok: true,
        token: 'secret',
      }).success,
    ).toBe(false);
    expect(
      ReviewRpcSchemas['review:listRuns'].params.safeParse({ limit: 101 })
        .success,
    ).toBe(false);
    expect(ReviewRunSchema.safeParse({}).success).toBe(false);
    expect(
      ReviewRpcSchemas['review:listRuns'].params.safeParse({
        state: 'interrupted',
      }).success,
    ).toBe(true);
    expect(
      CandidateFindingSchema.safeParse({
        ...finding,
        verification: 'cross-family',
      }).success,
    ).toBe(true);
    expect(
      CandidateFindingSchema.safeParse({
        ...finding,
        verification: 'unverified',
      }).success,
    ).toBe(false);
    expect(ReviewFindingSchema.safeParse(finding).success).toBe(false);
    expect(
      ReviewFindingSchema.safeParse({
        ...finding,
        verification: 'same-family-weaker',
      }).success,
    ).toBe(true);
    expect(
      ReviewRpcSchemas['review:listFindings'].params.safeParse({
        attemptId: 'attempt-1',
      }).success,
    ).toBe(true);
    expect(
      ReviewRpcSchemas['review:updateSettings'].params.safeParse({
        settings: {},
        token: 'secret',
      }).success,
    ).toBe(false);
    expect(
      ReviewRpcSchemas['review:getSettings'].result.safeParse({
        settings: {},
        hasToken: true,
        token: 'secret',
      }).success,
    ).toBe(false);
  });
});

describe('review repository allowlist', () => {
  it('accepts different repositories and rejects case-insensitive duplicates', () => {
    const settings = {
      repositories: [
        {
          owner: 'Acme',
          name: 'Widget',
          enabled: false,
          dryRun: true,
          publicationPaused: false,
        },
        {
          owner: 'Other',
          name: 'Tools',
          enabled: false,
          dryRun: true,
          publicationPaused: false,
        },
      ],
      maintainerLogins: [],
      pollMinutes: 10,
      globalPublicationPaused: false,
      fallbackFamilies: [],
    };
    expect(OperatorSettingsSchema.safeParse(settings).success).toBe(true);
    expect(
      OperatorSettingsSchema.safeParse({
        ...settings,
        repositories: [
          ...settings.repositories,
          { ...settings.repositories[0], owner: 'acme', name: 'widget' },
        ],
      }).success,
    ).toBe(false);
  });
});
import { ReviewFailureSchema } from './review-run.schema';

describe('review failure contract', () => {
  it('accepts safe failure details and rejects unknown codes', () => {
    const failure = { stage: 'context', code: 'checkout-missing', message: 'Checkout unavailable' };
    expect(ReviewFailureSchema.parse(failure)).toEqual(failure);
    expect(ReviewFailureSchema.safeParse({ ...failure, code: 'secret' }).success).toBe(false);
    expect(ReviewFailureSchema.safeParse({ ...failure, message: 'x'.repeat(301) }).success).toBe(false);
  });
});

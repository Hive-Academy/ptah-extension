import 'reflect-metadata';

import {
  ExtractedDraftSchema,
  ExtractedResponseSchema,
} from './extract.schema';
import { ResolvedDraftSchema, ResolvedResponseSchema } from './resolve.schema';

describe('curator-llm-adapter zod schemas', () => {
  describe('ExtractedDraftSchema', () => {
    it('round-trips a draft carrying all new fields intact', () => {
      const raw = {
        kind: 'fact',
        subject: 'Auth-Service',
        content: '  token rotation cadence is 7 days  ',
        salienceHint: 0.8,
        request: 'rotate auth tokens weekly',
        investigated: 'audited token store + retention policy',
        learned: 'rotation jitter avoids thundering herd',
        completed: 'shipped 7-day cron',
        nextSteps: 'monitor 95p latency next week',
        type: 'decision',
        concepts: ['auth', 'rotation', 'cron'],
        files: ['libs/backend/auth/src/lib/rotator.ts'],
      };

      const result = ExtractedDraftSchema.safeParse(raw);
      expect(result.success).toBe(true);
      if (!result.success) return;
      const draft = result.data;
      expect(draft).not.toBeNull();
      if (!draft) return;

      expect(draft.kind).toBe('fact');
      expect(draft.subject).toBe('auth-service');
      expect(draft.content).toBe('token rotation cadence is 7 days');
      expect(draft.salienceHint).toBe(0.8);
      expect(draft.request).toBe('rotate auth tokens weekly');
      expect(draft.investigated).toBe('audited token store + retention policy');
      expect(draft.learned).toBe('rotation jitter avoids thundering herd');
      expect(draft.completed).toBe('shipped 7-day cron');
      expect(draft.nextSteps).toBe('monitor 95p latency next week');
      expect(draft.type).toBe('decision');
      expect(draft.concepts).toEqual(['auth', 'rotation', 'cron']);
      expect(draft.files).toEqual(['libs/backend/auth/src/lib/rotator.ts']);
    });

    it('continues to validate legacy 4-field drafts (existing fields)', () => {
      const raw = {
        kind: 'preference',
        subject: 'naming',
        content: 'prefer kebab-case for file names',
        salienceHint: 0.4,
      };

      const result = ExtractedDraftSchema.safeParse(raw);
      expect(result.success).toBe(true);
      if (!result.success) return;
      const draft = result.data;
      expect(draft).not.toBeNull();
      if (!draft) return;

      expect(draft.kind).toBe('preference');
      expect(draft.subject).toBe('naming');
      expect(draft.salienceHint).toBe(0.4);
      expect(draft.type).toBe('discovery');
      expect(draft.concepts).toEqual([]);
      expect(draft.files).toEqual([]);
      expect(draft.request).toBeUndefined();
      expect(draft.investigated).toBeUndefined();
      expect(draft.learned).toBeUndefined();
      expect(draft.completed).toBeUndefined();
      expect(draft.nextSteps).toBeUndefined();
    });

    it('caps concepts at 5 entries and drops empty strings', () => {
      const raw = {
        kind: 'entity',
        subject: 'ptah',
        content: 'monorepo wrapper',
        salienceHint: 0.5,
        concepts: ['a', 'b', '', 'c', 'd', 'e', 'f', 'g'],
        files: ['a.ts', '', 'b.ts'],
      };

      const result = ExtractedDraftSchema.safeParse(raw);
      expect(result.success).toBe(true);
      if (!result.success || !result.data) return;
      expect(result.data.concepts).toEqual(['a', 'b', 'c', 'd', 'e']);
      expect(result.data.files).toEqual(['a.ts', 'b.ts']);
    });

    it('coerces unknown type strings to "discovery"', () => {
      const raw = {
        kind: 'fact',
        subject: null,
        content: 'x',
        salienceHint: 0.1,
        type: 'speculation',
      };
      const result = ExtractedDraftSchema.safeParse(raw);
      expect(result.success).toBe(true);
      if (!result.success || !result.data) return;
      expect(result.data.type).toBe('discovery');
    });

    it('clamps salienceHint into [0,1]', () => {
      const result = ExtractedDraftSchema.safeParse({
        kind: 'fact',
        subject: null,
        content: 'x',
        salienceHint: 5,
      });
      expect(result.success).toBe(true);
      if (!result.success || !result.data) return;
      expect(result.data.salienceHint).toBe(1);
    });

    it('returns null for blank content', () => {
      const result = ExtractedDraftSchema.safeParse({
        kind: 'fact',
        subject: null,
        content: '   ',
        salienceHint: 0.5,
      });
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data).toBeNull();
    });

    it('rejects unknown kind', () => {
      const result = ExtractedDraftSchema.safeParse({
        kind: 'idea',
        subject: null,
        content: 'x',
        salienceHint: 0.5,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('ExtractedResponseSchema', () => {
    it('parses a populated SDK response envelope round-trip', () => {
      const sdkResponse = {
        memories: [
          {
            kind: 'fact',
            subject: 'paddle',
            content: 'webhook dedup uses Postgres',
            salienceHint: 0.6,
            request: 'survive multi-instance deploys',
            investigated: 'in-memory Set in paddle-webhook.service.ts',
            learned: 'Set is process-local',
            completed: 'moved dedup to Prisma',
            nextSteps: 'backfill historical events',
            type: 'bugfix',
            concepts: ['webhook', 'dedup', 'paddle'],
            files: [
              'apps/ptah-license-server/src/paddle/paddle-webhook.service.ts',
            ],
          },
        ],
      };

      const env = ExtractedResponseSchema.safeParse(sdkResponse);
      expect(env.success).toBe(true);
      if (!env.success) return;
      expect(env.data.memories).toHaveLength(1);

      const draft = ExtractedDraftSchema.safeParse(env.data.memories[0]);
      expect(draft.success).toBe(true);
      if (!draft.success || !draft.data) return;
      expect(draft.data.type).toBe('bugfix');
      expect(draft.data.completed).toBe('moved dedup to Prisma');
      expect(draft.data.files).toEqual([
        'apps/ptah-license-server/src/paddle/paddle-webhook.service.ts',
      ]);
    });
  });

  describe('ResolvedDraftSchema', () => {
    it('preserves the new fields plus mergeTargetId', () => {
      const raw = {
        kind: 'fact',
        subject: 'auth',
        content: 'JWT secret rotates monthly',
        salienceHint: 0.5,
        learned: 'rotation aligns with audit',
        type: 'change',
        concepts: ['auth', 'rotation'],
        files: ['x.ts'],
        mergeTargetId: 'mem-123',
      };

      const result = ResolvedDraftSchema.safeParse(raw);
      expect(result.success).toBe(true);
      if (!result.success || !result.data) return;

      expect(result.data.mergeTargetId).toBe('mem-123');
      expect(result.data.type).toBe('change');
      expect(result.data.learned).toBe('rotation aligns with audit');
      expect(result.data.concepts).toEqual(['auth', 'rotation']);
    });

    it('normalises missing mergeTargetId to null', () => {
      const raw = {
        kind: 'fact',
        subject: 'auth',
        content: 'x',
        salienceHint: 0.5,
      };
      const result = ResolvedDraftSchema.safeParse(raw);
      expect(result.success).toBe(true);
      if (!result.success || !result.data) return;
      expect(result.data.mergeTargetId).toBeNull();
      expect(result.data.type).toBe('discovery');
    });
  });

  describe('ResolvedResponseSchema', () => {
    it('parses a populated resolve envelope round-trip', () => {
      const sdkResponse = {
        memories: [
          {
            kind: 'entity',
            subject: 'thoth',
            content: 'inner chrome with 4 tabs',
            salienceHint: 0.7,
            type: 'feature',
            concepts: ['thoth', 'tabs'],
            files: [],
            mergeTargetId: null,
          },
        ],
      };
      const env = ResolvedResponseSchema.safeParse(sdkResponse);
      expect(env.success).toBe(true);
      if (!env.success) return;
      const resolved = ResolvedDraftSchema.safeParse(env.data.memories[0]);
      expect(resolved.success).toBe(true);
      if (!resolved.success || !resolved.data) return;
      expect(resolved.data.type).toBe('feature');
      expect(resolved.data.mergeTargetId).toBeNull();
    });
  });
});

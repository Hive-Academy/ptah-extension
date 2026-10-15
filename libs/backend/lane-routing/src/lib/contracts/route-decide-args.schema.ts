import { z } from 'zod';
import { TASK_TYPES } from '@ptah-extension/shared';

export const PHASE_KINDS = [
  'plan',
  'architecture',
  'implement',
  'review',
  'document-review',
  'research',
  'tests',
  'docs',
  'visual-review',
  'design',
] as const;

export const DEPTHS = ['Full', 'Partial', 'Minimal'] as const;

const PhaseSchema = z
  .object({
    id: z.string().min(1).max(64),
    kind: z.enum(PHASE_KINDS),
    role: z.string().min(1).max(64).optional(),
    reviews: z.array(z.string()).max(64).optional(),
  })
  .strict();

const PinSchema = z
  .object({
    phaseId: z.string().min(1),
    executor: z.string().min(1),
    model: z.string().min(1).optional(),
  })
  .strict();

export const RouteDecideArgsSchema = z
  .discriminatedUnion('stage', [
    z
      .object({
        stage: z.literal('pre-flight'),
        request: z.string().min(1).max(8000),
      })
      .strict(),
    z
      .object({
        stage: z.literal('gate-0.1'),
        request: z.string().min(1).max(8000),
        taskType: z.enum(TASK_TYPES),
        depth: z.enum(DEPTHS),
        phases: z.array(PhaseSchema).min(1).max(100),
        pins: z.array(PinSchema).max(100).optional(),
        preferenceSource: z.string().max(200).optional(),
        preferences: z
          .object({ prefer: z.array(z.string()).max(32) })
          .strict()
          .optional(),
      })
      .strict(),
  ])
  .superRefine((args, ctx) => {
    if (args.stage !== 'gate-0.1') return;

    const phaseIds = new Set<string>();
    args.phases.forEach((phase, index) => {
      if (phaseIds.has(phase.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['phases', index, 'id'],
          message: 'phase id must be unique',
        });
      }
      phaseIds.add(phase.id);
    });

    args.phases.forEach((phase, index) => {
      phase.reviews?.forEach((reviewedId, reviewIndex) => {
        if (!phaseIds.has(reviewedId)) {
          ctx.addIssue({
            code: 'custom',
            path: ['phases', index, 'reviews', reviewIndex],
            message: 'reviewed phase id must name a phase',
          });
        }
      });
    });

    args.pins?.forEach((pin, index) => {
      if (!phaseIds.has(pin.phaseId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['pins', index, 'phaseId'],
          message: 'pin phase id must name a phase',
        });
      }
    });
  });

export type RouteDecideArgs = z.infer<typeof RouteDecideArgsSchema>;

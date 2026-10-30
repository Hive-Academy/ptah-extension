import { inject, Injectable } from '@angular/core';
import { LoggingService } from '@ptah-extension/core';
import {
  type HarnessConfig,
  type HarnessStartNewProjectResult,
  type NewProjectIntake,
} from '@ptah-extension/shared';
import { HarnessConfigUpdatesSchema } from '@ptah-extension/shared/schemas';
import { z } from 'zod';
import { canonicalHarnessRoot, isNewProjectIntake } from './harness-workflow-utils';

export { canonicalHarnessRoot } from './harness-workflow-utils';

export const HARNESS_RECORD_PREFIX = 'ptah.harness.builder.v1';
export const HARNESS_CHOICE_FIELDS = [
  'name',
  'persona',
  'agents',
  'skills',
  'prompt',
  'mcp',
  'claudeMd',
] as const;
export type HarnessChoiceField = (typeof HARNESS_CHOICE_FIELDS)[number];
export type HarnessBuilderMode = 'configure-harness' | 'new-project';

const rootSchema = z
  .string()
  .min(1)
  .refine((root) => root === canonicalHarnessRoot(root));
const tabSchema = z.string().trim().min(1).max(256);
const updatesSchema = z.custom<Partial<HarnessConfig>>(
  (value) => HarnessConfigUpdatesSchema.safeParse(value).success,
);
const fieldSchema = z.enum(HARNESS_CHOICE_FIELDS);

const snapshotSchema = z
  .strictObject({
    version: z.literal(1),
    workspaceRoot: rootSchema,
    tabId: tabSchema,
    configUpdates: updatesSchema,
    fields: z.partialRecord(
      fieldSchema,
      z.strictObject({
        source: z.literal('user'),
        chosenAt: z.iso.datetime(),
        updatedAt: z.iso.datetime(),
      }),
    ),
    lastApplied: updatesSchema.optional(),
  })
  .superRefine((record, ctx) => {
    for (const field of HARNESS_CHOICE_FIELDS) {
      if (
        (record.fields[field] !== undefined) !==
        (record.configUpdates[field] !== undefined)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['fields', field],
          message: 'Choice and value must match',
        });
      }
    }
    for (const key of Object.keys(record.configUpdates)) {
      if (!HARNESS_CHOICE_FIELDS.includes(key as HarnessChoiceField)) {
        ctx.addIssue({
          code: 'custom',
          path: ['configUpdates', key],
          message: 'Not a user choice field',
        });
      }
    }
  });

const draftSchema = z.strictObject({
  version: z.literal(1),
  workspaceRoot: rootSchema,
  tabId: tabSchema,
  mode: z.enum(['configure-harness', 'new-project']),
});

const stackProfileSchema = z.strictObject({
  version: z.literal(1),
  workspaceRoot: rootSchema,
  tabId: tabSchema,
  plugins: z.strictObject({
    enabledBundled: z.array(z.string()),
    missingExternal: z.array(
      z.strictObject({ marketplace: z.string(), plugin: z.string() }),
    ),
    availableSkillIds: z.array(z.string()),
  }),
  toolchain: z
    .strictObject({
      profileId: z.enum(['node-ts', 'dotnet', 'python']),
      command: z.string(),
      installed: z.boolean(),
      version: z.string().optional(),
      satisfiesMin: z.boolean(),
      minVersion: z.string(),
      installHint: z.string(),
    })
    .optional(),
  capturedAt: z.iso.datetime(),
});

const sessionSchema = z.strictObject({
  version: z.literal(1),
  tabId: tabSchema,
  sessionId: z.string().min(1).optional(),
  mode: z.enum(['configure-harness', 'new-project']),
  workspacePath: rootSchema,
  intake: z.custom<NewProjectIntake>((value) =>
    isNewProjectIntake(value),
  ).optional(),
  teamIntent: z.string().optional(),
  intakeHash: z.string().min(1),
  sendAttempt: z.strictObject({
    count: z.number().int().nonnegative(),
    ackedAt: z.iso.datetime().optional(),
  }),
  lastRevisionId: z.string().optional(),
  appliedRevisionId: z.string().optional(),
  applyReceipt: z.strictObject({
    revisionId: z.string(),
    appliedPaths: z.array(z.string()),
    warnings: z.array(z.string()),
    appliedAt: z.iso.datetime({ offset: true }),
  }).optional(),
});

export type HarnessUserSnapshot = z.infer<typeof snapshotSchema>;
export type HarnessDraftPointer = z.infer<typeof draftSchema>;
export type HarnessStackProfileRecord = z.infer<typeof stackProfileSchema>;
export type HarnessSessionRecord = z.infer<typeof sessionSchema>;

function recordKey(
  kind: 'snapshot' | 'stack' | 'session',
  root: string,
  tabId: string,
): string {
  return `${HARNESS_RECORD_PREFIX}.${kind}.${keyPart(root)}.${keyPart(tabId)}`;
}

function draftKey(root: string, mode: HarnessBuilderMode): string {
  return `${HARNESS_RECORD_PREFIX}.draft.${keyPart(root)}.${mode}`;
}

function keyPart(value: string): string {
  return encodeURIComponent(value).replace(/\./g, '%2E');
}

@Injectable({ providedIn: 'root' })
export class HarnessBuilderRecordsService {
  private readonly logger = inject(LoggingService);

  readSession(workspaceRoot: string, tabId: string): HarnessSessionRecord | null {
    const root = canonicalHarnessRoot(workspaceRoot);
    if (!root || !tabSchema.safeParse(tabId).success) return null;
    return this.read(recordKey('session', root, tabId), sessionSchema, root, tabId);
  }

  writeSession(record: HarnessSessionRecord): boolean {
    const parsed = sessionSchema.safeParse(record);
    return parsed.success && this.write(
      recordKey('session', parsed.data.workspacePath, parsed.data.tabId),
      parsed.data,
    );
  }

  readSnapshot(
    workspaceRoot: string,
    tabId: string,
  ): HarnessUserSnapshot | null {
    const root = canonicalHarnessRoot(workspaceRoot);
    if (!root || !tabSchema.safeParse(tabId).success) return null;
    return this.read(
      recordKey('snapshot', root, tabId),
      snapshotSchema,
      root,
      tabId,
    );
  }

  writeSnapshot(snapshot: HarnessUserSnapshot): boolean {
    const parsed = snapshotSchema.safeParse(snapshot);
    if (!parsed.success) return false;
    return this.write(
      recordKey('snapshot', parsed.data.workspaceRoot, parsed.data.tabId),
      parsed.data,
    );
  }

  readStackProfile(
    workspaceRoot: string,
    tabId: string,
  ): HarnessStackProfileRecord | null {
    const root = canonicalHarnessRoot(workspaceRoot);
    if (!root || !tabSchema.safeParse(tabId).success) return null;
    return this.read(
      recordKey('stack', root, tabId),
      stackProfileSchema,
      root,
      tabId,
    );
  }

  writeStackProfile(
    workspaceRoot: string,
    tabId: string,
    result: Extract<HarnessStartNewProjectResult, { success: true }>,
  ): boolean {
    const root = canonicalHarnessRoot(workspaceRoot);
    const parsed = stackProfileSchema.safeParse({
      version: 1,
      workspaceRoot: root,
      tabId,
      plugins: result.plugins,
      toolchain: result.toolchain,
      capturedAt: new Date().toISOString(),
    });
    return (
      parsed.success &&
      this.write(recordKey('stack', root, parsed.data.tabId), parsed.data)
    );
  }

  readDraft(
    workspaceRoot: string,
    mode: HarnessBuilderMode,
  ): HarnessDraftPointer | null {
    const root = canonicalHarnessRoot(workspaceRoot);
    if (!root) return null;
    const key = draftKey(root, mode);
    const draft = this.read(key, draftSchema, root);
    if (draft && draft.mode !== mode) {
      this.remove(key);
      return null;
    }
    return draft;
  }

  writeDraft(
    workspaceRoot: string,
    mode: HarnessBuilderMode,
    tabId: string,
  ): boolean {
    const root = canonicalHarnessRoot(workspaceRoot);
    const parsed = draftSchema.safeParse({
      version: 1,
      workspaceRoot: root,
      tabId,
      mode,
    });
    return parsed.success && this.write(draftKey(root, mode), parsed.data);
  }

  /** A replaced draft loses local data; its durable backend proposal remains untouched. */
  replaceDraft(
    workspaceRoot: string,
    mode: HarnessBuilderMode,
    tabId: string,
  ): boolean {
    const old = this.readDraft(workspaceRoot, mode);
    if (old?.tabId === tabId) return true;
    if (!this.writeDraft(workspaceRoot, mode, tabId)) return false;
    if (old) this.clearTab(workspaceRoot, old.tabId);
    return true;
  }

  clearDraft(workspaceRoot: string, mode: HarnessBuilderMode): void {
    const root = canonicalHarnessRoot(workspaceRoot);
    if (root) this.remove(draftKey(root, mode));
  }

  /** Used for Start over, Discard, tab close and session deletion. */
  clearTab(workspaceRoot: string, tabId: string): void {
    const root = canonicalHarnessRoot(workspaceRoot);
    if (!root || !tabSchema.safeParse(tabId).success) return;
    this.remove(recordKey('snapshot', root, tabId));
    this.remove(recordKey('stack', root, tabId));
    this.remove(recordKey('session', root, tabId));
    for (const mode of ['configure-harness', 'new-project'] as const) {
      if (this.readDraft(root, mode)?.tabId === tabId)
        this.clearDraft(root, mode);
    }
  }

  sweepOrphans(workspaceRoot: string, liveTabIds: ReadonlySet<string>): void {
    const root = canonicalHarnessRoot(workspaceRoot);
    if (!root) return;
    const prefix = `${HARNESS_RECORD_PREFIX}.`;
    try {
      const storage = globalThis.localStorage;
      for (let index = storage.length - 1; index >= 0; index--) {
        const key = storage.key(index);
        if (!key?.startsWith(prefix)) continue;
        for (const kind of ['snapshot', 'stack', 'session'] as const) {
          const recordPrefix = `${prefix}${kind}.${keyPart(root)}.`;
          if (key.startsWith(recordPrefix)) {
            let tabId: string;
            try {
              tabId = decodeURIComponent(key.slice(recordPrefix.length));
            } catch {
              storage.removeItem(key);
              continue;
            }
            if (!tabSchema.safeParse(tabId).success || !liveTabIds.has(tabId))
              storage.removeItem(key);
          }
        }
      }
      for (const mode of ['configure-harness', 'new-project'] as const) {
        const draft = this.readDraft(root, mode);
        if (draft && !liveTabIds.has(draft.tabId)) this.clearDraft(root, mode);
      }
    } catch {
      this.logger.warn(
        'HarnessBuilderRecordsService',
        'Could not sweep local builder records',
      );
    }
  }

  private read<T extends { tabId: string }>(
    key: string,
    schema: z.ZodType<T>,
    root: string,
    tabId?: string,
  ): T | null {
    try {
      const raw = globalThis.localStorage?.getItem(key);
      if (raw === null || raw === undefined) return null;
      const parsed = schema.safeParse(JSON.parse(raw));
      if (
        parsed.success &&
        ('workspaceRoot' in parsed.data
          ? parsed.data.workspaceRoot === root
          : 'workspacePath' in parsed.data && parsed.data.workspacePath === root) &&
        (tabId === undefined || parsed.data.tabId === tabId)
      )
        return parsed.data;
      this.remove(key);
    } catch {
      this.remove(key);
    }
    return null;
  }

  private write(key: string, record: object): boolean {
    try {
      globalThis.localStorage?.setItem(key, JSON.stringify(record));
      return globalThis.localStorage !== undefined;
    } catch (err) {
      this.logger.error(
        'HarnessBuilderRecordsService',
        'Could not persist local builder record',
        err instanceof Error ? err : new Error(String(err)),
      );
      return false;
    }
  }

  private remove(key: string): void {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      this.logger.warn(
        'HarnessBuilderRecordsService',
        'Could not remove local builder record',
      );
    }
  }
}

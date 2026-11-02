import {
  computed,
  effect,
  inject,
  Injectable,
  InjectionToken,
  signal,
} from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  NotificationService,
  VSCodeService,
  attentionConditionKey,
} from '@ptah-extension/core';
import {
  HarnessBuilderRecordsService,
  HarnessProposalHydrationService,
  HarnessSessionController,
  canonicalHarnessRoot,
  type HarnessSessionController as SessionController,
} from '@ptah-extension/harness-builder';
import {
  mergeHarnessConfigUpdates,
  type HarnessConfig,
} from '@ptah-extension/shared';
type HarnessBuilderMode = Parameters<HarnessSessionController['session']>[0];
type HarnessUserSnapshot = NonNullable<
  ReturnType<HarnessBuilderRecordsService['readSnapshot']>
>;
type HarnessFoldedRevision = ReturnType<
  HarnessProposalHydrationService['revisions']
>[number];

export const HARNESS_FLOW_MODE = new InjectionToken<HarnessBuilderMode>(
  'HARNESS_FLOW_MODE',
);
export type ChangeTag = 'new' | 'changed';

/** Compare complete folded snapshots. Paths are stable field names, not raw partial updates. */
export function diffHarnessConfig(
  prev: Partial<HarnessConfig>,
  next: Partial<HarnessConfig>,
): ReadonlyMap<string, ChangeTag> {
  const tags = new Map<string, ChangeTag>();
  const walk = (before: unknown, after: unknown, path: string): void => {
    if (Object.is(before, after)) return;
    if (after === undefined) return;
    if (after !== null && typeof after === 'object' && !Array.isArray(after)) {
      if (before === undefined && path) tags.set(path, 'new');
      for (const [key, value] of Object.entries(after)) {
        walk(
          before !== null &&
            typeof before === 'object' &&
            !Array.isArray(before)
            ? (before as Record<string, unknown>)[key]
            : undefined,
          value,
          path ? `${path}.${key}` : key,
        );
      }
      return;
    }
    if (JSON.stringify(before) !== JSON.stringify(after))
      tags.set(path, before === undefined ? 'new' : 'changed');
  };
  walk(prev, next, '');
  return tags;
}

@Injectable({ providedIn: 'root' })
export class ProposalFlowStore {
  readonly mode = inject(HARNESS_FLOW_MODE);
  private readonly controller: SessionController = inject(
    HarnessSessionController,
  );
  readonly session = this.controller.session(this.mode);
  readonly hydration = inject(HarnessProposalHydrationService);
  readonly records = inject(HarnessBuilderRecordsService);
  private readonly tabs = inject(TabManagerService);
  private readonly vscode = inject(VSCodeService);
  private readonly notifications = inject(NotificationService);
  readonly generatedDocument = signal<string | null>(null);
  readonly revisions = this.hydration.revisions;
  readonly current = computed(() => this.revisions().at(-1) ?? null);
  readonly changeTags = computed(() => {
    const revisions = this.revisions();
    if (revisions.length < 2) return new Map<string, ChangeTag>();
    return diffHarnessConfig(
      revisions.at(-2)?.config ?? {},
      revisions.at(-1)?.config ?? {},
    );
  });
  readonly reviewEligible = computed(
    () =>
      this.hydration.status() === 'ready' &&
      this.current() !== null &&
      Object.keys(this.hydration.config()).length > 0 &&
      !!this.session.record()?.sessionId &&
      canonicalHarnessRoot(this.session.record()?.workspacePath ?? '') ===
        canonicalHarnessRoot(this.workspaceRoot()),
  );
  readonly restoreState = signal<
    | 'idle'
    | 'loading'
    | 'ready'
    | 'restore-draft'
    | 'missing'
    | 'workspace-mismatch'
    | 'wrong-mode'
    | 'proposal-unavailable'
  >('idle');
  readonly actionError = signal<string | null>(null);
  readonly leaveOpen = signal(false);
  readonly leaveSaving = signal(false);
  readonly leaveFailed = signal(false);
  readonly stopUncertain = signal(false);
  readonly lastStartCreated = signal(false);
  readonly conflictMode = signal<HarnessBuilderMode | null>(null);
  readonly lastStopChoice = signal<'save' | 'discard'>('save');
  private pendingStart: Parameters<typeof this.session.start>[0] | null = null;
  private boundSessionId: string | null = null;
  readonly workspaceRoot = computed(
    () =>
      this.tabs.activeWorkspacePath || this.vscode.config().workspaceRoot || '',
  );

  private reportStopFailure(message: string): void {
    this.actionError.set(message);
    const workspacePath = canonicalHarnessRoot(this.workspaceRoot());
    this.notifications.upsert({
      key: attentionConditionKey(workspacePath, `onboarding-stop:${this.mode}`),
      generation: Date.now(),
      source: 'onboarding',
      kind: 'failure',
      severity: 'error',
      workspacePath,
      workspaceName:
        workspacePath.split('/').filter(Boolean).at(-1) ?? 'Workspace',
      title: message,
      actions: [],
      actionable: false,
      soundEligible: false,
    });
  }

  constructor() {
    effect(() => {
      const record = this.session.record();
      if (!record?.sessionId || record.sessionId === this.boundSessionId)
        return;
      this.boundSessionId = record.sessionId;
      void this.hydration.bind(
        record.workspacePath,
        record.tabId,
        [record.sessionId],
        this.records.readSnapshot(record.workspacePath, record.tabId),
      );
    });
  }

  async start(
    request: Parameters<typeof this.session.start>[0],
  ): Promise<string | null> {
    this.actionError.set(null);
    this.lastStartCreated.set(false);
    const result = await this.session.start(request);
    if (result.kind === 'conflict') {
      this.pendingStart = request;
      this.conflictMode.set(result.otherMode);
      this.leaveOpen.set(true);
      return null;
    }
    if (result.kind === 'failed') {
      this.actionError.set(result.error);
      return null;
    }
    this.lastStartCreated.set(result.kind === 'started');
    return result.tabId;
  }

  async resolveConflict(
    choice: 'save' | 'discard' | 'cancel',
  ): Promise<string | null> {
    if (choice === 'cancel') {
      this.leaveOpen.set(false);
      this.pendingStart = null;
      this.conflictMode.set(null);
      this.stopUncertain.set(false);
      return null;
    }
    this.lastStopChoice.set(choice);
    this.leaveFailed.set(false);
    const request = this.pendingStart;
    if (!request) {
      this.leaveSaving.set(true);
      try {
        const result = await this.controller.leave(this.mode, choice);
        if (result === 'uncertain') this.stopUncertain.set(true);
        else if (result === 'save-failed') this.leaveFailed.set(true);
        else {
          this.stopUncertain.set(false);
          this.leaveOpen.set(false);
        }
      } catch {
        this.actionError.set('Could not stop the current session. Try again.');
      } finally {
        this.leaveSaving.set(false);
      }
      return null;
    }
    const otherMode: HarnessBuilderMode =
      this.mode === 'new-project' ? 'configure-harness' : 'new-project';
    this.leaveSaving.set(true);
    let result: Awaited<ReturnType<SessionController['leave']>>;
    try {
      const active = this.controller.activeSessionIn(request.workspaceRoot);
      if (active?.mode === otherMode) {
        const other = this.controller.session(otherMode);
        if (other.record()?.tabId !== active.tabId) {
          const binding = this.requestFor(
            otherMode,
            request.workspaceRoot,
            active.tabId,
          );
          const rebound = binding ? await other.start(binding) : null;
          if (
            !rebound ||
            (rebound.kind !== 'reused' && rebound.kind !== 'started')
          ) {
            this.actionError.set(
              'Could not open the current session. Try again.',
            );
            return null;
          }
        }
      }
      result = await this.controller.leave(otherMode, choice);
    } catch {
      // degradation-audit: reported — actionError shows a retryable session-stop failure.
      this.actionError.set('Could not stop the current session. Try again.');
      return null;
    } finally {
      this.leaveSaving.set(false);
    }
    if (result === 'uncertain') {
      this.stopUncertain.set(true);
      return null;
    }
    if (result === 'save-failed') {
      this.leaveFailed.set(true);
      return null;
    }
    this.leaveOpen.set(false);
    this.stopUncertain.set(false);
    this.pendingStart = null;
    this.conflictMode.set(null);
    return this.start(request);
  }

  async restore(tabId: string): Promise<void> {
    this.restoreState.set('loading');
    this.actionError.set(null);
    const current = this.session.record();
    let result =
      current?.tabId === tabId &&
      canonicalHarnessRoot(current.workspacePath) ===
        canonicalHarnessRoot(this.workspaceRoot())
        ? 'ready'
        : await this.session.restore(tabId);
    if (
      result === 'proposal-unavailable' &&
      this.controller.activeSessionIn(this.workspaceRoot())?.tabId === tabId
    ) {
      const binding = this.requestFor(this.mode, this.workspaceRoot(), tabId);
      if (binding && (await this.session.start(binding)).kind === 'reused')
        result = 'ready';
    }
    if (result !== 'ready') {
      this.restoreState.set(result);
      return;
    }
    const record = this.session.record();
    if (!record) {
      this.restoreState.set('missing');
      return;
    }
    this.boundSessionId = record.sessionId ?? null;
    await this.hydration.bind(
      record.workspacePath,
      record.tabId,
      record.sessionId ? [record.sessionId] : [],
      this.records.readSnapshot(record.workspacePath, record.tabId),
    );
    this.restoreState.set(
      ['error', 'unavailable'].includes(this.hydration.status())
        ? 'proposal-unavailable'
        : 'ready',
    );
  }

  private requestFor(
    mode: HarnessBuilderMode,
    workspaceRoot: string,
    tabId: string,
  ): Parameters<typeof this.session.start>[0] | null {
    const saved = this.records.readSession(workspaceRoot, tabId);
    if (saved?.mode !== mode) return null;
    if (saved.mode === 'new-project' && saved.intake)
      return { mode: 'new-project', workspaceRoot, intake: saved.intake };
    if (saved.mode === 'configure-harness' && saved.teamIntent)
      return {
        mode: 'configure-harness',
        workspaceRoot,
        intent: saved.teamIntent,
      };
    return null;
  }

  async discardCancelledStart(): Promise<void> {
    try {
      if ((await this.controller.leave(this.mode, 'discard')) === 'uncertain') {
        this.stopUncertain.set(true);
        this.reportStopFailure(
          'Could not confirm the session stopped. Return to onboarding before starting another session.',
        );
      }
    } catch {
      this.reportStopFailure(
        'Could not discard the cancelled session. Return to onboarding before starting another session.',
      );
    }
  }

  leaveCurrent(
    choice: 'save' | 'discard',
  ): ReturnType<SessionController['leave']> {
    return this.controller.leave(this.mode, choice);
  }

  restoreRevision(id: string): boolean {
    const revision: HarnessFoldedRevision | undefined = this.revisions().find(
      (entry) => entry.id === id,
    );
    const record = this.session.record();
    if (!revision || !record) return false;
    const now = new Date().toISOString();
    const existing = this.records.readSnapshot(
      record.workspacePath,
      record.tabId,
    );
    const updates: Partial<HarnessConfig> = {};
    const fields: HarnessUserSnapshot['fields'] = { ...existing?.fields };
    const resetKeys: Array<keyof Partial<HarnessConfig>> = [];
    const current: Partial<HarnessConfig> = this.current()?.config ?? {};
    for (const key of [
      'name',
      'persona',
      'agents',
      'skills',
      'prompt',
      'mcp',
      'claudeMd',
    ] as const) {
      if (revision.config[key] === undefined) continue;
      if (
        JSON.stringify(revision.config[key]) === JSON.stringify(current[key])
      ) {
        if (existing?.configUpdates[key] !== undefined) {
          resetKeys.push(key);
          delete fields[key];
        }
        continue;
      }
      Object.assign(updates, { [key]: revision.config[key] });
      Object.assign(fields, {
        [key]: { source: 'user', chosenAt: now, updatedAt: now },
      });
    }
    const configUpdates = mergeHarnessConfigUpdates(
      existing?.configUpdates ?? {},
      updates,
    );
    for (const key of resetKeys) delete configUpdates[key];
    const snapshot: HarnessUserSnapshot = {
      version: 1,
      workspaceRoot: record.workspacePath,
      tabId: record.tabId,
      configUpdates,
      fields,
      ...(existing?.lastApplied ? { lastApplied: existing.lastApplied } : {}),
    };
    if (!this.records.writeSnapshot(snapshot)) {
      this.actionError.set('Could not restore this revision. Try again.');
      return false;
    }
    this.hydration.setSnapshot(snapshot);
    this.actionError.set(null);
    return true;
  }
}

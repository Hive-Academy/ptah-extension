import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { isActiveWorkspaceTabSet, TabManagerService } from '@ptah-extension/chat-state';
import { ClaudeRpcService, ElectronLayoutService, PluginCatalogService, VSCodeService, WorkspaceScopeService } from '@ptah-extension/core';
import type { SetupGenerationWorkflow, SetupStatusGetResponse } from '@ptah-extension/shared';
import { z } from 'zod';
import { GenerationWorkflowLauncherService } from '../../services/generation-workflow-launcher.service';

/**
 * The one next step the readiness ring offers. The screen maps it to the
 * Marketplace skills page, `launchWizard()` or
 * `launchGeneration('setup-agent-generation')`.
 */
export type SetupNextAction = 'open-library' | 'run-setup' | 'generate-agents';

/** What the scan check needs from one `wizard:list-analyses` answer. */
interface ScanSnapshot {
  readonly key: string;
  readonly analysisCount: number;
  /** Project type of the newest saved analysis, when it names one. */
  readonly projectType: string | null;
}

const SCAN_ERROR = 'Could not check the project scan. Please try again.';

/**
 * The part of a `wizard:list-analyses` answer the scan check reads. The RPC
 * result is typed, but the data crosses the host boundary unchecked, so it is
 * validated here. Each listed analysis needs only its project type; other
 * fields are ignored, and a missing type is allowed (older saved analyses).
 */
const ListAnalysesScanSchema = z.object({
  analyses: z.array(z.object({ projectType: z.string().optional() })),
});

/** The scan check's facts from one answer (newest first); `null` when malformed. */
function toScanFacts(data: unknown): Omit<ScanSnapshot, 'key'> | null {
  const parsed = ListAnalysesScanSchema.safeParse(data);
  if (!parsed.success) return null;
  const { analyses } = parsed.data;
  const type = analyses[0]?.projectType?.trim() ?? '';
  return { analysisCount: analyses.length, projectType: type === '' ? null : type };
}

/**
 * One workspace-scoped source of readiness for canvas and single-chat: three
 * checks (Skills, Scan, Agents). A check is `null` while unknown, and every
 * count over the checks is `null` until all three are known.
 *
 * The scan check is `wizard:list-analyses` (any saved analysis). This lib must
 * not reach the indexing lib, so the scan caption here is the project type
 * only; the chat lib's `WorkspaceVitalsStore` adds the indexed file count.
 */
@Injectable({ providedIn: 'root' })
export class SetupStatusStore {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly catalog = inject(PluginCatalogService);
  private readonly scope = inject(WorkspaceScopeService);
  private readonly tabs = inject(TabManagerService);
  private readonly vscode = inject(VSCodeService);
  private readonly electronLayout = inject(ElectronLayoutService);
  private readonly generationLauncher = inject(GenerationWorkflowLauncherService);

  private readonly snapshot = signal<{ key: string; value: SetupStatusGetResponse } | null>(null);
  private readonly pendingKey = signal<string | null>(null);
  private readonly scanSnapshot = signal<ScanSnapshot | null>(null);
  private requestId = 0;
  private scanRequestId = 0;
  private inFlight: { key: string; promise: Promise<void> } | null = null;
  readonly error = signal<string | null>(null);
  /** Fixed copy when the scan list could not be read; the check stays unknown. */
  readonly scanError = signal<string | null>(null);
  readonly launchError = signal<string | null>(null);
  readonly folderError = signal<string | null>(null);
  readonly workspaceNotOpen = signal(false);
  readonly launching = signal(false);
  readonly status = computed(() => {
    const snapshot = this.snapshot();
    return snapshot?.key === this.scope.scopeKey() ? snapshot.value : null;
  });
  readonly isLoading = computed(() => this.pendingKey() === this.scope.scopeKey());
  readonly skillsReady = computed<boolean | null>(() =>
    !this.catalog.isLoaded() || this.catalog.error() ? null : this.catalog.hasEnabledPlugins(),
  );
  readonly agentsReady = computed<boolean | null>(() =>
    this.workspaceNotOpen() || !this.status()
      ? null
      : this.status()!.isConfigured,
  );
  private readonly scan = computed(() => {
    const snapshot = this.scanSnapshot();
    return snapshot?.key === this.scope.scopeKey() && !this.workspaceNotOpen() ? snapshot : null;
  });
  /** True when this workspace has a saved project analysis. */
  readonly scanReady = computed<boolean | null>(() => {
    const scan = this.scan();
    return scan === null ? null : scan.analysisCount > 0;
  });
  /** The scan caption's project type (newest analysis); `null` when none is known. */
  readonly scanProjectType = computed<string | null>(() => this.scan()?.projectType ?? null);
  readonly readyCount = computed<number | null>(() => {
    const checks = [this.skillsReady(), this.scanReady(), this.agentsReady()];
    return checks.some((ready) => ready === null)
      ? null
      : checks.filter((ready) => ready === true).length;
  });
  readonly allReady = computed(() => this.readyCount() === 3);
  /**
   * The next step, once all three checks are known. Nothing ready at all is a
   * first run, which starts with setup; otherwise the first incomplete check
   * in the order Skills, Scan, Agents. `null` when all are ready or any is
   * unknown.
   */
  readonly nextAction = computed<SetupNextAction | null>(() => {
    const skills = this.skillsReady();
    const scan = this.scanReady();
    const agents = this.agentsReady();
    if (skills === null || scan === null || agents === null) return null;
    if (!skills && !scan && !agents) return 'run-setup';
    if (!skills) return 'open-library';
    if (!scan) return 'run-setup';
    if (!agents) return 'generate-agents';
    return null;
  });

  constructor() {
    effect(() => {
      this.scope.scopeKey();
      untracked(() => {
        this.error.set(null);
        this.scanError.set(null);
        this.launchError.set(null);
        this.folderError.set(null);
        this.workspaceNotOpen.set(false);
        void this.catalog.ensureLoaded();
        void this.refresh();
      });
    });
  }

  async refresh(): Promise<void> {
    const key = this.scope.scopeKey();
    if (this.inFlight?.key === key) return this.inFlight.promise;
    const promise = Promise.all([this.readStatus(key), this.readScan(key)])
      .then(() => undefined)
      .finally(() => {
        if (this.inFlight?.promise === promise) this.inFlight = null;
      });
    this.inFlight = { key, promise };
    return promise;
  }

  /**
   * Reads the saved analyses for the scan check. A failure keeps the last
   * answer of this scope (stale beats unknown) and publishes fixed copy; a
   * superseded read is dropped.
   */
  private async readScan(key: string): Promise<void> {
    const id = ++this.scanRequestId;
    this.scanError.set(null);
    let facts: Omit<ScanSnapshot, 'key'> | null = null;
    try {
      const result = await this.rpc.call('wizard:list-analyses', {}, { timeout: 10000 });
      if (result.isSuccess()) facts = toScanFacts(result.data);
    } catch {
      // degradation-audit: reported - the failure is published on scanError() as fixed copy; the scan check stays unknown (null) so it is never counted as not ready. The thrown detail is withheld.
      facts = null;
    }
    if (id !== this.scanRequestId || key !== this.scope.scopeKey()) return;
    if (facts === null) {
      this.scanError.set(SCAN_ERROR);
      return;
    }
    this.scanSnapshot.set({ key, ...facts });
  }

  private async readStatus(key: string): Promise<void> {
    const id = ++this.requestId;
    this.pendingKey.set(key);
    this.error.set(null);
    this.workspaceNotOpen.set(false);
    try {
      const result = await this.rpc.call('setup-status:get-status', {}, { timeout: 10000 });
      if (id !== this.requestId || key !== this.scope.scopeKey()) return;
      if (result.isSuccess() && result.data) {
        this.snapshot.set({ key, value: result.data });
        if (!this.launching()) this.launchError.set(null);
      } else if (result.errorCode === 'WORKSPACE_NOT_OPEN') {
        this.snapshot.set(null);
        this.workspaceNotOpen.set(true);
      } else {
        this.snapshot.set(null);
        this.error.set('Could not check agent setup. Please try again.');
      }
    } catch {
      // degradation-audit: reported - the failure is published on error() as fixed copy beside a Retry button; the thrown detail is withheld so backend text never reaches the card. The stale-scope early return is intentional: a newer read owns the state.
      if (id !== this.requestId || key !== this.scope.scopeKey()) return;
      this.snapshot.set(null);
      this.error.set('Could not check agent setup. Please try again.');
    } finally {
      if (id === this.requestId && key === this.scope.scopeKey()) this.pendingKey.set(null);
    }
  }

  async retry(): Promise<void> {
    await Promise.all([this.catalog.refresh(), this.refresh()]);
  }

  async openFolder(): Promise<void> {
    this.folderError.set(null);
    try {
      if (this.vscode.config().isElectron) {
        const outcome = await this.electronLayout.addFolder();
        if (outcome === 'failed') this.folderError.set('Could not open a folder. Please try again.');
        return;
      }
      const result = await this.rpc.call('command:execute', { command: 'workbench.action.files.openFolder' }, { timeout: 10000 });
      if (!result.isSuccess()) this.folderError.set('Could not open a folder. Please try again.');
    } catch {
      // degradation-audit: reported — the folder error is shown in Home.
      this.folderError.set('Could not open a folder. Please try again.');
    }
  }

  async launchWizard(): Promise<void> {
    if (this.launching()) return;
    this.launching.set(true);
    this.launchError.set(null);
    try {
      const result = await this.rpc.call('setup-wizard:launch', {}, { timeout: 5000 });
      if (!result.isSuccess()) this.launchError.set('Could not launch setup. Please try again.');
    } catch {
      this.launchError.set('Could not launch setup. Please try again.');
    } finally {
      await this.refresh();
      this.launching.set(false);
    }
  }

  async launchGeneration(workflow: SetupGenerationWorkflow): Promise<void> {
    if (this.launching()) return;
    this.launching.set(true);
    this.launchError.set(null);
    try {
      const config = this.vscode.config();
      const workspacePath = this.tabs.activeWorkspacePath ?? config.workspaceRoot;
      const result = isActiveWorkspaceTabSet(workspacePath, this.tabs.activeWorkspacePath, config.workspaceRoot, config.isVSCode)
        ? await this.generationLauncher.open({ workspacePath, workflow, origin: 'independent-start' })
        : { outcome: 'failed' as const };
      if (result.outcome === 'failed') this.launchError.set('Could not open generation. Please try again.');
    } catch {
      this.launchError.set('Could not open generation. Please try again.');
    } finally {
      this.launching.set(false);
    }
  }
}

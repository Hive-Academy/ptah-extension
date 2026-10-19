import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { isActiveWorkspaceTabSet, TabManagerService } from '@ptah-extension/chat-state';
import { ClaudeRpcService, PluginCatalogService, VSCodeService, WorkspaceScopeService } from '@ptah-extension/core';
import type { SetupGenerationWorkflow, SetupStatusGetResponse } from '@ptah-extension/shared';
import { GenerationWorkflowLauncherService } from '../../services/generation-workflow-launcher.service';

/** One workspace-scoped source of readiness for canvas and single-chat. */
@Injectable({ providedIn: 'root' })
export class SetupStatusStore {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly catalog = inject(PluginCatalogService);
  private readonly scope = inject(WorkspaceScopeService);
  private readonly tabs = inject(TabManagerService);
  private readonly vscode = inject(VSCodeService);
  private readonly generationLauncher = inject(GenerationWorkflowLauncherService);

  private readonly snapshot = signal<{ key: string; value: SetupStatusGetResponse } | null>(null);
  private readonly pendingKey = signal<string | null>(null);
  private requestId = 0;
  private inFlight: { key: string; promise: Promise<void> } | null = null;
  readonly error = signal<string | null>(null);
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
  readonly readyCount = computed<number | null>(() => {
    const skills = this.skillsReady();
    const agents = this.agentsReady();
    return skills === null || agents === null ? null : Number(skills) + Number(agents);
  });
  readonly allReady = computed(() => this.readyCount() === 2);

  constructor() {
    effect(() => {
      this.scope.scopeKey();
      untracked(() => {
        this.error.set(null);
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
    const promise = this.readStatus(key).finally(() => {
      if (this.inFlight?.promise === promise) this.inFlight = null;
    });
    this.inFlight = { key, promise };
    return promise;
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
      const result = await this.rpc.call('command:execute', { command: 'workbench.action.files.openFolder' }, { timeout: 10000 });
      if (!result.isSuccess()) this.folderError.set('Could not open a folder. Please try again.');
    } catch {
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

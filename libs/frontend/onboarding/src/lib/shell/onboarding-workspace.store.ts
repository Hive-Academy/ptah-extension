import { computed, effect, inject, Injectable, Injector, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { ElectronLayoutService, VSCodeService } from '@ptah-extension/core';
import { SetupWizardStateService } from '@ptah-extension/setup-wizard';
import { combineLatest, firstValueFrom, timeout } from 'rxjs';
import { filter } from 'rxjs/operators';
import { AnalysisStepStore } from '../analyze/analysis-step.store';

/** The onboarding entry screens' view of the Electron workspace selector. */
@Injectable({ providedIn: 'root' })
export class OnboardingWorkspaceStore {
  private readonly layout = inject(ElectronLayoutService);
  private readonly vscode = inject(VSCodeService);
  private readonly analysis = inject(AnalysisStepStore);
  private readonly wizard = inject(SetupWizardStateService);
  private readonly injector = inject(Injector);
  private readonly switching = signal(false);
  readonly folderError = signal<string | null>(null);
  readonly isElectron = this.vscode.config().isElectron;
  readonly folders = computed(() => this.isElectron ? this.layout.workspaceFolders() : []);
  readonly active = computed(() => this.isElectron ? this.layout.activeWorkspace() : null);
  readonly activeIndex = computed(() => this.isElectron ? this.layout.activeWorkspaceIndex() : -1);
  readonly activePath = computed(() => this.isElectron
    ? this.active()?.path ?? null
    : this.vscode.config().workspaceRoot ?? null);
  readonly readyForActivePath = computed(() => !this.isElectron ||
    (this.layout.workspaceResolved() && !this.layout.workspaceSwitchPending()));
  readonly canSwitch = computed(() => this.isElectron && this.readyForActivePath() && !this.switching());

  constructor() {
    let previous = this.activePath();
    effect(() => {
      const path = this.activePath();
      if (path !== previous) {
        previous = path;
        this.analysis.resetForWorkspace();
        this.wizard.reset();
      }
    });
  }

  switchTo(index: number): void {
    if (!this.canSwitch() || !this.folders()[index]) return;
    this.layout.switchWorkspace(index);
  }

  async openFolder(): Promise<void> {
    await this.pickFolder('open');
  }

  async createFolder(): Promise<void> {
    await this.pickFolder('create');
  }

  private async pickFolder(mode: 'open' | 'create'): Promise<void> {
    if (!this.canSwitch()) return;
    this.folderError.set(null);
    this.switching.set(true);
    try {
      const result = await this.layout.addFolder(mode);
      if (result === 'failed') {
        this.folderError.set('Could not open a folder. Please try again.');
      } else if (result === 'added') {
        const chosenPath = this.activePath();
        if (!this.readyForActivePath())
          await firstValueFrom(combineLatest([
            toObservable(this.readyForActivePath, { injector: this.injector }),
            toObservable(this.activePath, { injector: this.injector }),
          ]).pipe(
            filter(([ready, path]) => ready || path !== chosenPath),
            timeout({ first: 35_000 }),
          ));
        if (this.activePath() !== chosenPath)
          this.folderError.set('Could not switch to that folder. Please try again.');
      }
    } catch {
      // degradation-audit: reported — the header shows a retryable folder error.
      this.folderError.set('Could not open a folder. Please try again.');
    } finally {
      this.switching.set(false);
    }
  }

}

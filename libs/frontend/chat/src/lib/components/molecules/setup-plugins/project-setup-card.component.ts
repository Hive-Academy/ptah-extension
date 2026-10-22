import { ChangeDetectionStrategy, Component, inject, OnDestroy, OnInit } from '@angular/core';
import { SetupStatusStore } from '@ptah-extension/chat-ui';
import { AppStateManager, PluginCatalogService } from '@ptah-extension/core';
import { BookOpen, Bot, Check, LucideAngularModule, ScanLine } from 'lucide-angular';

/** Shared Get ready surface for canvas and single-chat. */
@Component({
  selector: 'ptah-project-setup-card',
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="surface-3 rounded-lg border border-base-300 p-4 text-left" data-glass-surface="tile" aria-labelledby="get-ready-title">
      @if (setup.allReady()) {
        <div class="flex flex-wrap items-center gap-2">
          <h2 id="get-ready-title" class="flex flex-1 items-center gap-2 text-sm font-semibold text-base-content"><lucide-angular [img]="checkIcon" class="size-4 text-success" aria-hidden="true" />Ready</h2>
          <button type="button" class="btn btn-xs btn-outline" [disabled]="setup.launching()" (click)="setup.launchWizard()">@if (setup.launching()) { <span class="loading loading-spinner loading-xs" aria-hidden="true"></span> } Run setup</button>
          <button type="button" class="btn btn-xs btn-outline" [disabled]="setup.launching()" (click)="setup.launchGeneration('setup-agent-generation')">Generate agents</button>
          <button type="button" class="btn btn-xs btn-outline" [disabled]="setup.launching()" (click)="setup.launchGeneration('setup-project-prompt')">Project guidance</button>
        </div>
      } @else {
        <div class="flex flex-wrap items-start gap-2">
          <div class="flex-1 min-w-0"><p class="mb-1 text-[10px] font-bold uppercase tracking-widest text-secondary-focus">Before you begin</p><h2 id="get-ready-title" class="text-sm font-semibold text-base-content">Get ready</h2><p class="text-xs text-base-content-muted">Prepare your skills and agents so Ptah can understand your workspace.</p></div>
          <span class="badge badge-ghost text-base-content" aria-live="polite">@if (setup.readyCount() === null) { {{ setup.workspaceNotOpen() ? 'Open a folder to check' : setup.isLoading() || !catalog.isLoaded() && !catalog.error() ? 'Checking readiness' : 'Readiness unavailable' }} } @else { {{ setup.readyCount() }} of 2 ready }</span>
        </div>
        <div class="mt-3 divide-y divide-base-300">
          <div class="py-2 flex flex-wrap items-center gap-2"><span class="flex size-7 shrink-0 items-center justify-center rounded-lg bg-base-200 text-secondary-focus" aria-hidden="true"><lucide-angular [img]="setup.skillsReady() ? checkIcon : bookIcon" class="size-4" /></span><span class="flex-1 min-w-0 text-xs text-base-content"><strong>Skills</strong><br><span class="text-base-content-muted">@if (setup.skillsReady() === null) { {{ catalog.error() ? 'Readiness unavailable' : 'Checking' }} } @else if (setup.skillsReady()) { Ready } @else { No skills enabled }</span></span><button type="button" class="btn btn-xs btn-outline" (click)="openLibrary()">Open Library</button></div>
          <div class="py-2 flex flex-wrap items-center gap-2"><span class="flex size-7 shrink-0 items-center justify-center rounded-lg bg-base-200 text-secondary-focus" aria-hidden="true"><lucide-angular [img]="setup.agentsReady() ? checkIcon : botIcon" class="size-4" /></span><span class="flex-1 min-w-0 text-xs text-base-content"><strong>Agents</strong><br><span class="text-base-content-muted">@if (setup.agentsReady() === null) { {{ setup.workspaceNotOpen() ? 'Open a folder to check' : setup.isLoading() ? 'Checking' : 'Readiness unavailable' }} } @else if (setup.agentsReady()) { {{ setup.status()?.agentCount }} {{ setup.status()?.agentCount === 1 ? 'agent' : 'agents' }} configured } @else { Not configured }</span></span><button type="button" class="btn btn-xs btn-outline" [disabled]="setup.launching() || setup.workspaceNotOpen()" (click)="setup.launchWizard()">@if (setup.launching()) { <span class="loading loading-spinner loading-xs" aria-hidden="true"></span> } {{ setup.agentsReady() ? 'Update' : 'Configure' }}</button></div>
          <div class="py-2 flex flex-wrap items-center gap-2"><span class="flex size-7 shrink-0 items-center justify-center rounded-lg bg-base-200 text-secondary-focus" aria-hidden="true"><lucide-angular [img]="scanIcon" class="size-4" /></span><span class="flex-1 min-w-0 text-xs text-base-content"><strong>Project scan</strong><br><span class="text-base-content-muted">Run setup to scan this workspace</span></span><button type="button" class="btn btn-xs btn-outline" [disabled]="setup.launching() || setup.workspaceNotOpen()" (click)="setup.launchWizard()">@if (setup.launching()) { <span class="loading loading-spinner loading-xs" aria-hidden="true"></span> } Run setup</button></div>
        </div>
        <div class="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label="Setup tools"><span class="text-xs text-base-content-muted">Setup tools</span><button type="button" class="btn btn-xs btn-outline" [disabled]="setup.launching() || setup.workspaceNotOpen()" (click)="setup.launchGeneration('setup-agent-generation')">Generate agents</button><button type="button" class="btn btn-xs btn-outline" [disabled]="setup.launching() || setup.workspaceNotOpen()" (click)="setup.launchGeneration('setup-project-prompt')">Project guidance</button></div>
        @if (setup.workspaceNotOpen()) { <div class="mt-2 flex flex-wrap items-center gap-2 text-xs text-base-content-muted"><span>Open a folder to configure agents</span><button type="button" class="btn btn-xs btn-outline" (click)="setup.openFolder()">Open Folder</button></div> }
        @if (setup.error() || catalog.error()) { <div class="mt-2 flex flex-wrap items-center gap-2 text-xs text-error" role="alert"><span>Could not check setup. Please try again.</span><button type="button" class="btn btn-xs btn-outline" (click)="setup.retry()">Retry</button></div> }
        @if (setup.folderError()) { <p class="mt-2 text-xs text-error" role="alert">{{ setup.folderError() }}</p> }
      }
      @if (setup.launchError()) { <p class="mt-2 text-xs text-error" role="alert">{{ setup.launchError() }}</p> }
    </section>
  `,
  styles: [`
    :host { display: block; container-type: inline-size; }
    :host-context([data-theme='anubis-light']) section { box-shadow: inset 0 1px 0 var(--surface-highlight), var(--elev-shadow); }
    @container (max-width: 360px) {
      section { padding: 14px 12px; }
      section > div > button, section > div > div > button { width: 100%; }
      .badge { margin-top: 4px; }
    }
  `],
})
export class ProjectSetupCardComponent implements OnInit, OnDestroy {
  readonly bookIcon = BookOpen;
  readonly botIcon = Bot;
  readonly scanIcon = ScanLine;
  readonly checkIcon = Check;
  readonly setup = inject(SetupStatusStore);
  readonly catalog = inject(PluginCatalogService);
  private readonly appState = inject(AppStateManager);
  private readonly onVisible = () => { if (!document.hidden) void this.setup.refresh(); };
  ngOnInit(): void {
    void this.setup.refresh();
    document.addEventListener('visibilitychange', this.onVisible);
    window.addEventListener('focus', this.onVisible);
  }
  ngOnDestroy(): void {
    document.removeEventListener('visibilitychange', this.onVisible);
    window.removeEventListener('focus', this.onVisible);
  }
  openLibrary(): void { this.appState.openMarketplace({ page: 'skills', source: 'ptah-plugins' }); }
}

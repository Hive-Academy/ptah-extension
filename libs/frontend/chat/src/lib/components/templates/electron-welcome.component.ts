/**
 * Electron Welcome Component
 *
 * Shown when no workspace folder is open in the Electron desktop app.
 * Prompts the user to open a folder before they can use chat/sessions.
 */

import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import {
  LucideAngularModule,
  FolderOpen,
  Sparkles,
  ArrowRight,
} from 'lucide-angular';
import { ElectronLayoutService, VSCodeService } from '@ptah-extension/core';

@Component({
  selector: 'ptah-electron-welcome',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
      height: 100%;
      width: 100%;
    }
  `,
  template: `
    <div class="flex items-center justify-center h-full bg-base-100">
      <div class="flex flex-col items-center text-center max-w-md px-8">
        <!-- Logo -->

        <img
          [src]="ptahIconUri"
          alt="Ptah"
          class="w-16 h-16 mb-6 opacity-80"
          width="64"
          height="64"
        />

        <!-- Heading -->
        <h1 class="text-2xl font-bold text-base-content mb-2">
          Welcome to Ptah Desktop
        </h1>
        <p class="text-sm text-base-content/50 mb-8 leading-relaxed">
          Open a project folder to get started. Ptah will analyze your workspace
          and configure AI agents tailored to your codebase.
        </p>

        <!-- Open Folder CTA -->
        <button class="btn btn-primary btn-lg gap-3 mb-6" (click)="addFolder()">
          <lucide-angular [img]="FolderOpenIcon" class="w-5 h-5" />
          Open Folder
          <lucide-angular [img]="ArrowRightIcon" class="w-4 h-4" />
        </button>

        <!-- Features list -->
        <div class="flex flex-col gap-3 w-full mt-4">
          @for (feature of features; track feature.title) {
            <div class="flex items-start gap-3 text-left">
              <div
                class="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5"
              >
                <lucide-angular
                  [img]="SparklesIcon"
                  class="w-4 h-4 text-primary"
                />
              </div>
              <div>
                <span class="text-sm font-medium text-base-content/80">{{
                  feature.title
                }}</span>
                <p class="text-xs text-base-content/40 mt-0.5">
                  {{ feature.description }}
                </p>
              </div>
            </div>
          }
        </div>
      </div>
    </div>
  `,
})
export class ElectronWelcomeComponent {
  protected readonly layout = inject(ElectronLayoutService);
  private readonly vscodeService = inject(VSCodeService);

  readonly FolderOpenIcon = FolderOpen;
  readonly SparklesIcon = Sparkles;
  readonly ArrowRightIcon = ArrowRight;

  readonly ptahIconUri = this.vscodeService.getPtahIconUri();

  readonly features = [
    {
      title: 'Workspace Intelligence',
      description:
        'Auto-detects your tech stack, frameworks, and project structure.',
    },
    {
      title: 'AI Agent Orchestra',
      description:
        'Specialized agents for frontend, backend, testing, and more.',
    },
    {
      title: 'Context-Aware Chat',
      description:
        'Chat with full awareness of your codebase and dependencies.',
    },
  ];

  public addFolder() {
    this.layout.addFolder();
  }
}

import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ViewportAnimationDirective,
  ViewportAnimationConfig,
} from '@hive-academy/angular-gsap';
import {
  LucideAngularModule,
  Puzzle,
  ArrowRight,
  Package,
  Play,
} from 'lucide-angular';

import { DocsSectionShellComponent } from '../components/docs-section-shell.component';
import { DocsCollapsibleCardComponent } from '../components/docs-collapsible-card.component';

interface PluginSkill {
  name: string;
  command?: string;
}

interface PluginData {
  name: string;
  description: string;
  isDefault: boolean;
  skillCount: number;
  commandCount: number;
  skills: PluginSkill[];
}

@Component({
  selector: 'ptah-docs-plugins',
  imports: [
    CommonModule,
    ViewportAnimationDirective,
    LucideAngularModule,
    DocsSectionShellComponent,
    DocsCollapsibleCardComponent,
  ],
  template: `
    <ptah-docs-section-shell sectionId="plugins">
      <h2
        viewportAnimation
        [viewportConfig]="headingConfig"
        class="text-2xl sm:text-3xl font-display font-bold text-base-content mb-3"
      >
        Plugins
      </h2>
      <p
        viewportAnimation
        [viewportConfig]="introConfig"
        class="text-neutral-content mb-8 max-w-2xl"
      >
        Extend Ptah with skill plugins that add specialized agents, workflows,
        and code patterns. Browse and install plugins from the
        <strong class="text-base-content/70">"Configure Ptah Skills"</strong>
        modal in the settings panel.
      </p>

      <div class="space-y-8" viewportAnimation [viewportConfig]="contentConfig">
        @for (plugin of plugins; track plugin.name; let first = $first) {
        <ptah-docs-collapsible-card
          [icon]="plugin.isDefault ? PackageIcon : PuzzleIcon"
          [title]="plugin.name"
          [subtitle]="plugin.isDefault ? 'Default' : ''"
          [expanded]="first"
        >
          <p class="text-sm text-neutral-content mb-4">
            {{ plugin.description }}
          </p>

          <!-- Badges -->
          <div class="flex items-center gap-3 mb-4">
            <span
              class="px-2.5 py-1 rounded-lg bg-base-300/50 border border-secondary/10 text-xs text-neutral-content"
            >
              {{ plugin.skillCount }}
              {{ plugin.skillCount === 1 ? 'skill' : 'skills' }}
            </span>
            @if (plugin.commandCount > 0) {
            <span
              class="px-2.5 py-1 rounded-lg bg-base-300/50 border border-secondary/10 text-xs text-neutral-content"
            >
              {{ plugin.commandCount }}+ commands
            </span>
            }
          </div>

          <!-- Skills grid -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            @for (skill of plugin.skills; track skill.name) {
            <div
              class="flex items-center gap-2 px-3 py-2 rounded-lg bg-base-300/50 border border-secondary/10"
            >
              <lucide-angular
                [img]="ArrowRightIcon"
                class="w-3 h-3 text-secondary/60 shrink-0"
                aria-hidden="true"
              />
              <span class="text-sm text-base-content/70">{{ skill.name }}</span>
            </div>
            }
          </div>
        </ptah-docs-collapsible-card>
        }
      </div>

      <ng-container media>
        <div
          class="group relative cursor-pointer"
          (click)="toggleVideo($event)"
        >
          <video
            muted
            loop
            playsinline
            preload="metadata"
            class="w-full rounded-xl border border-white/10 shadow-2xl"
          >
            <source src="assets/videos/plugins.mp4" type="video/mp4" />
          </video>
          <div
            class="absolute inset-0 flex items-center justify-center rounded-xl bg-black/30 transition-opacity duration-300 pointer-events-none"
            [class.opacity-0]="isPlaying()"
            [class.opacity-100]="!isPlaying()"
          >
            <div
              class="w-20 h-20 rounded-full bg-white/90 backdrop-blur-sm flex items-center justify-center shadow-xl"
            >
              <lucide-icon
                [img]="PlayIcon"
                class="w-10 h-10 text-slate-900 mr-1"
                [size]="40"
              />
            </div>
          </div>
        </div>
      </ng-container>
    </ptah-docs-section-shell>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PluginsSectionComponent {
  public readonly PuzzleIcon = Puzzle;
  public readonly ArrowRightIcon = ArrowRight;
  public readonly PackageIcon = Package;
  public readonly PlayIcon = Play;

  public readonly plugins: PluginData[] = [
    {
      name: 'Ptah Core',
      description:
        'The foundational plugin — includes orchestration workflows, code review, DDD architecture, technical content writing, UI/UX design, and a skill creator for building your own plugins.',
      isDefault: true,
      skillCount: 6,
      commandCount: 5,
      skills: [
        { name: 'Orchestration' },
        { name: 'Code Review' },
        { name: 'DDD Architecture' },
        { name: 'Content Writer' },
        { name: 'UI/UX Designer' },
        { name: 'Skill Creator' },
      ],
    },
    {
      name: 'Ptah Angular',
      description:
        'Angular-focused skills for building immersive 3D scenes, scalable frontend patterns, and smooth GSAP scroll animations.',
      isDefault: false,
      skillCount: 3,
      commandCount: 0,
      skills: [
        { name: '3D Scene Crafter' },
        { name: 'Frontend Patterns' },
        { name: 'GSAP Animations' },
      ],
    },
    {
      name: 'Ptah NX SaaS',
      description:
        'Enterprise-grade skills for NestJS backend patterns, Nx workspace architecture, webhook handling, resilient service design, SaaS monetization, and production deployment.',
      isDefault: false,
      skillCount: 7,
      commandCount: 2,
      skills: [
        { name: 'NestJS Patterns' },
        { name: 'NX Workspace Architect' },
        { name: 'SaaS Initializer', command: '/init-saas' },
        { name: 'Webhook Architecture' },
        { name: 'Resilient NestJS Patterns' },
        { name: 'SaaS Platform Patterns' },
        { name: 'NestJS Deployment' },
      ],
    },
    {
      name: 'Ptah React',
      description:
        'React-focused skills covering composition patterns, best practices enforcement, and Nx monorepo patterns for React projects.',
      isDefault: false,
      skillCount: 3,
      commandCount: 0,
      skills: [
        { name: 'Composition Patterns' },
        { name: 'Best Practices' },
        { name: 'NX Patterns' },
      ],
    },
  ];

  public readonly headingConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.6,
    threshold: 0.2,
  };

  public readonly introConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.6,
    delay: 0.1,
    threshold: 0.2,
  };

  public readonly contentConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.7,
    delay: 0.15,
    threshold: 0.1,
  };

  public readonly isPlaying = signal(false);

  public toggleVideo(event: MouseEvent): void {
    const container = event.currentTarget as HTMLElement;
    const video = container.querySelector('video');
    if (!video) return;
    if (video.paused) {
      video.play();
      this.isPlaying.set(true);
    } else {
      video.pause();
      this.isPlaying.set(false);
    }
  }
}

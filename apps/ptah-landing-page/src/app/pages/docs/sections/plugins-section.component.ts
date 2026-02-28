import { Component, ChangeDetectionStrategy } from '@angular/core';
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
} from 'lucide-angular';

import { DocsSectionShellComponent } from '../components/docs-section-shell.component';

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
  ],
  template: `
    <ptah-docs-section-shell sectionId="plugins">
      <h2
        viewportAnimation
        [viewportConfig]="headingConfig"
        class="text-2xl sm:text-3xl font-display font-bold text-white/90 mb-3"
      >
        Plugins
      </h2>
      <p
        viewportAnimation
        [viewportConfig]="introConfig"
        class="text-white/50 mb-8 max-w-2xl"
      >
        Extend Ptah with skill plugins that add specialized agents, workflows,
        and code patterns. Browse and install plugins from the
        <strong class="text-white/70">"Configure Ptah Skills"</strong> modal in
        the settings panel.
      </p>

      <div class="space-y-8" viewportAnimation [viewportConfig]="contentConfig">
        @for (plugin of plugins; track plugin.name) {
        <div
          class="rounded-xl border border-amber-500/15 bg-slate-800/30 p-5 sm:p-6"
        >
          <div class="flex items-center gap-3 mb-4">
            <div
              class="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center"
            >
              <lucide-angular
                [img]="plugin.isDefault ? PackageIcon : PuzzleIcon"
                class="w-4 h-4 text-amber-400"
                aria-hidden="true"
              />
            </div>
            <div class="flex items-center gap-2 flex-wrap">
              <h3 class="text-lg font-semibold text-white/90">
                {{ plugin.name }}
              </h3>
              @if (plugin.isDefault) {
              <span
                class="px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-xs font-medium text-amber-400"
                >Default</span
              >
              }
            </div>
          </div>

          <p class="text-sm text-white/50 mb-4">{{ plugin.description }}</p>

          <!-- Badges -->
          <div class="flex items-center gap-3 mb-4">
            <span
              class="px-2.5 py-1 rounded-lg bg-slate-700/40 border border-slate-600/30 text-xs text-white/60"
            >
              {{ plugin.skillCount }}
              {{ plugin.skillCount === 1 ? 'skill' : 'skills' }}
            </span>
            @if (plugin.commandCount > 0) {
            <span
              class="px-2.5 py-1 rounded-lg bg-slate-700/40 border border-slate-600/30 text-xs text-white/60"
            >
              {{ plugin.commandCount }}+ commands
            </span>
            }
          </div>

          <!-- Skills grid -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            @for (skill of plugin.skills; track skill.name) {
            <div
              class="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-700/30 border border-slate-600/30"
            >
              <lucide-angular
                [img]="ArrowRightIcon"
                class="w-3 h-3 text-amber-400/60 shrink-0"
                aria-hidden="true"
              />
              <span class="text-sm text-white/70">{{ skill.name }}</span>
            </div>
            }
          </div>
        </div>
        }
      </div>

      <ng-container media>
        <div
          class="group relative cursor-pointer"
          (click)="toggleVideo($event)"
        >
          <video
            autoplay
            muted
            loop
            playsinline
            preload="metadata"
            class="w-full rounded-xl border border-white/10 shadow-2xl"
          >
            <source src="assets/videos/plugins.mp4" type="video/mp4" />
          </video>
          <div
            class="absolute inset-0 flex items-center justify-center rounded-xl bg-black/0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none"
          >
            <span
              class="px-3 py-1.5 rounded-lg bg-slate-900/80 border border-amber-500/20 text-xs font-medium text-white/90 backdrop-blur-sm"
            >
              Click to play / pause
            </span>
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
        'Enterprise-grade skills for NestJS backend patterns, Nx workspace architecture, and full-stack SaaS project scaffolding.',
      isDefault: false,
      skillCount: 3,
      commandCount: 0,
      skills: [
        { name: 'NestJS Patterns' },
        { name: 'NX Workspace Architect' },
        { name: 'SaaS Initializer' },
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

  public toggleVideo(event: MouseEvent): void {
    const container = event.currentTarget as HTMLElement;
    const video = container.querySelector('video');
    if (!video) return;
    if (video.paused) {
      video.play();
    } else {
      video.pause();
    }
  }
}

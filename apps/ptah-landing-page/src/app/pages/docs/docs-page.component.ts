import {
  Component,
  ChangeDetectionStrategy,
  signal,
  afterNextRender,
  DestroyRef,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationComponent } from '../../components/navigation.component';
import {
  DocsSidebarComponent,
  DocsSectionLink,
} from './components/docs-sidebar.component';
import { DocsHeroComponent } from './sections/docs-hero.component';
import { InstallationSectionComponent } from './sections/installation-section.component';
import { AuthenticationSectionComponent } from './sections/authentication-section.component';
import { ProvidersApiSectionComponent } from './sections/providers-api-section.component';
import { PluginsSectionComponent } from './sections/plugins-section.component';
import { SetupWizardSectionComponent } from './sections/setup-wizard-section.component';
import { AgentOrchestrationSectionComponent } from './sections/agent-orchestration-section.component';
import { McpServerSectionComponent } from './sections/mcp-server-section.component';
import { DocsCtaSectionComponent } from './sections/docs-cta-section.component';
import { FooterComponent } from '../../components/footer.component';
import {
  ViewportAnimationDirective,
  ViewportAnimationConfig,
} from '@hive-academy/angular-gsap';
import { DocsVideoModalComponent } from './components/docs-video-modal.component';
import { DocsVideoModalService } from './services/docs-video-modal.service';

@Component({
  selector: 'ptah-docs-page',
  imports: [
    CommonModule,
    NavigationComponent,
    DocsSidebarComponent,
    DocsHeroComponent,
    InstallationSectionComponent,
    AuthenticationSectionComponent,
    ProvidersApiSectionComponent,
    PluginsSectionComponent,
    SetupWizardSectionComponent,
    AgentOrchestrationSectionComponent,
    McpServerSectionComponent,
    DocsCtaSectionComponent,
    FooterComponent,
    ViewportAnimationDirective,
    DocsVideoModalComponent,
  ],
  providers: [DocsVideoModalService],
  template: `
    <div class="min-h-screen bg-base-100 text-base-content">
      <ptah-navigation />

      <!-- Dot navigation — fixed left edge, vertically centered (desktop only) -->
      <nav
        class="hidden lg:flex flex-col items-center fixed left-3 top-1/2 -translate-y-1/2 z-30 gap-3 py-3"
        aria-label="Table of contents"
      >
        @for (section of sections; track section.id) {
          <button
            type="button"
            class="dot-nav-item group relative flex items-center"
            (click)="scrollToSection(section.id)"
            [attr.aria-label]="section.label"
            [attr.aria-current]="activeSection() === section.id ? 'true' : null"
          >
            <!-- Dot -->
            <span
              class="block rounded-full transition-all duration-300 shrink-0"
              [ngClass]="
                activeSection() === section.id
                  ? 'w-3 h-3 bg-amber-400 shadow-[0_0_8px_rgba(212,175,55,0.5)]'
                  : 'w-2 h-2 bg-white/25 group-hover:bg-white/60'
              "
            ></span>
            <!-- Tooltip label — appears on hover -->
            <span
              class="absolute left-full ml-3 px-2.5 py-1 rounded-md bg-slate-800/95 border border-amber-500/20 text-xs text-white/90 font-medium whitespace-nowrap opacity-0 -translate-x-2 pointer-events-none transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0"
            >
              {{ section.label }}
            </span>
          </button>
        }
      </nav>

      <!-- Main content area — full width (no sidebar offset) -->
      <main class="pt-16 pb-20">
        <div class="px-4 sm:px-6 lg:pl-12 lg:pr-10 xl:pl-14 xl:pr-14">
          <!-- Mobile TOC -->
          <div class="lg:hidden pt-8">
            <ptah-docs-sidebar
              [sections]="sections"
              [activeSection]="activeSection()"
              (sectionClick)="scrollToSection($event)"
            />
          </div>

          <ptah-docs-hero />

          <ptah-docs-installation />

          <div
            viewportAnimation
            [viewportConfig]="sectionDividerConfig"
            class="overflow-hidden my-8 sm:my-12"
          >
            <div
              class="h-[1px] w-full bg-gradient-to-r from-transparent via-secondary/40 to-transparent"
            ></div>
          </div>

          <ptah-docs-authentication />

          <div
            viewportAnimation
            [viewportConfig]="sectionDividerConfig"
            class="overflow-hidden my-8 sm:my-12"
          >
            <div
              class="h-[1px] w-full bg-gradient-to-r from-transparent via-secondary/40 to-transparent"
            ></div>
          </div>

          <ptah-docs-providers-api />

          <div
            viewportAnimation
            [viewportConfig]="sectionDividerConfig"
            class="overflow-hidden my-8 sm:my-12"
          >
            <div
              class="h-[1px] w-full bg-gradient-to-r from-transparent via-secondary/40 to-transparent"
            ></div>
          </div>

          <ptah-docs-plugins />

          <div
            viewportAnimation
            [viewportConfig]="sectionDividerConfig"
            class="overflow-hidden my-8 sm:my-12"
          >
            <div
              class="h-[1px] w-full bg-gradient-to-r from-transparent via-secondary/40 to-transparent"
            ></div>
          </div>

          <ptah-docs-agent-orchestration />

          <div
            viewportAnimation
            [viewportConfig]="sectionDividerConfig"
            class="overflow-hidden my-8 sm:my-12"
          >
            <div
              class="h-[1px] w-full bg-gradient-to-r from-transparent via-secondary/40 to-transparent"
            ></div>
          </div>

          <ptah-docs-setup-wizard />

          <div
            viewportAnimation
            [viewportConfig]="sectionDividerConfig"
            class="overflow-hidden my-8 sm:my-12"
          >
            <div
              class="h-[1px] w-full bg-gradient-to-r from-transparent via-secondary/40 to-transparent"
            ></div>
          </div>

          <ptah-docs-mcp-server />

          <div
            viewportAnimation
            [viewportConfig]="sectionDividerConfig"
            class="overflow-hidden my-8 sm:my-12"
          >
            <div
              class="h-[1px] w-full bg-gradient-to-r from-transparent via-secondary/40 to-transparent"
            ></div>
          </div>

          <ptah-docs-cta />
        </div>
      </main>

      <ptah-footer />

      <ptah-docs-video-modal />
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        overflow-x: hidden;
      }
      .dot-nav-item {
        cursor: pointer;
        padding: 4px;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocsPageComponent {
  private readonly destroyRef = inject(DestroyRef);

  public readonly activeSection = signal('installation');

  /** Gold line divider animation config between sections */
  public readonly sectionDividerConfig: ViewportAnimationConfig = {
    animation: 'custom',
    duration: 1.0,
    delay: 0.2,
    threshold: 0.3,
    from: { scaleX: 0, transformOrigin: 'center' },
    to: { scaleX: 1 },
  };

  public readonly sections: DocsSectionLink[] = [
    { id: 'installation', label: 'Installation & Pro Trial' },
    { id: 'authentication', label: 'Claude CLI & Auth' },
    { id: 'providers', label: 'Provider APIs' },
    { id: 'plugins', label: 'Plugins' },
    { id: 'setup-wizard', label: 'Setup Wizard' },
    { id: 'agent-orchestration', label: 'Agent Orchestration' },
    { id: 'mcp-server', label: 'MCP Server' },
  ];

  private observer: IntersectionObserver | null = null;

  public constructor() {
    afterNextRender(() => {
      this.initScrollSpy();
    });
  }

  public scrollToSection(id: string): void {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  private initScrollSpy(): void {
    const sectionIds = this.sections.map((s) => s.id);
    const elements = sectionIds
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);

    if (elements.length === 0) return;

    this.observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

        if (visible.length > 0) {
          this.activeSection.set(visible[0].target.id);
        }
      },
      {
        rootMargin: '-100px 0px -60% 0px',
        threshold: 0,
      },
    );

    elements.forEach((el) => this.observer?.observe(el));

    this.destroyRef.onDestroy(() => {
      this.observer?.disconnect();
    });
  }
}

import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'ptah-cta-section',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="py-24 bg-base-100 border-t border-base-300">
      <div class="container mx-auto px-6 text-center">
        <!-- Main Heading -->
        <h2
          class="text-4xl md:text-5xl font-display font-bold text-accent mb-6"
        >
          Begin Your Journey
        </h2>

        <!-- Subheading -->
        <p class="text-lg text-base-content/70 mb-12 max-w-2xl mx-auto">
          Join developers transforming their Claude Code experience with
          Egyptian-powered intelligence
        </p>

        <!-- CTA Buttons -->
        <div class="flex flex-col sm:flex-row gap-4 justify-center mb-16">
          <!-- Primary CTA: VS Code Marketplace -->
          <a
            href="https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code"
            target="_blank"
            rel="noopener noreferrer"
            class="bg-gradient-to-r from-secondary to-accent text-secondary-content px-10 py-5 rounded-2xl text-xl font-semibold shadow-[0_0_40px_rgba(212,175,55,0.4)] hover:scale-105 transition-transform"
            aria-label="Install Ptah extension from VS Code Marketplace"
          >
            Install from VS Code Marketplace
          </a>

          <!-- Secondary CTA: GitHub -->
          <a
            href="https://github.com/anthropics/claude-code"
            target="_blank"
            rel="noopener noreferrer"
            class="border-2 border-base-300 text-base-content px-10 py-5 rounded-2xl text-xl font-medium hover:border-base-content hover:bg-base-200/50 transition-all"
            aria-label="View Ptah source code on GitHub"
          >
            View on GitHub
          </a>
        </div>

        <!-- Footer -->
        <footer class="border-t border-base-300 pt-8" role="contentinfo">
          <!-- Copyright -->
          <p class="text-sm text-base-content/50">
            MIT License • © 2025 Hive Academy
          </p>

          <!-- Footer Links -->
          <nav
            class="flex justify-center gap-6 mt-4"
            aria-label="Footer navigation"
          >
            <a
              href="https://github.com/anthropics/claude-code"
              target="_blank"
              rel="noopener noreferrer"
              class="text-base-content/40 hover:text-base-content/70 transition-colors text-sm"
              aria-label="Visit our GitHub repository"
            >
              GitHub
            </a>
            <a
              href="#"
              class="text-base-content/40 hover:text-base-content/70 transition-colors text-sm"
              aria-label="View documentation"
            >
              Documentation
            </a>
          </nav>
        </footer>
      </div>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CTASectionComponent {}

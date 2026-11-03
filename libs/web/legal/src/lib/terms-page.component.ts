import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { SeoService } from '@ptah-web/core';
import {
  ViewportAnimationDirective,
  ViewportAnimationConfig,
} from '@hive-academy/angular-gsap';
import { NavigationComponent } from '@ptah-web/ui';
import { FooterComponent } from '@ptah-web/ui';
import { FallingCubesBackgroundComponent } from './components/falling-cubes-background.component';

@Component({
  selector: 'ptah-terms-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NavigationComponent,
    FooterComponent,
    ViewportAnimationDirective,
    FallingCubesBackgroundComponent,
  ],
  template: `
    <div class="min-h-screen bg-slate-950 text-white/90">
      <ptah-navigation />

      <main class="relative pt-24 pb-16 px-4 sm:px-6">
        <!-- Falling Cubes along edges -->
        <ptah-falling-cubes-background />
        <div class="max-w-4xl mx-auto">
          <!-- Page Header -->
          <div viewportAnimation [viewportConfig]="headerConfig" class="mb-10">
            <h1
              class="text-3xl sm:text-4xl font-display font-bold text-amber-400 mb-2"
            >
              Terms of Service
            </h1>
            <p class="text-white/40">Last Updated: November 2026</p>
          </div>

          <!-- 1. Acceptance of Terms -->
          <section
            id="acceptance"
            viewportAnimation
            [viewportConfig]="sectionConfig"
            class="mb-8 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 sm:p-8 backdrop-blur-sm"
          >
            <h2 class="text-2xl font-display font-semibold text-amber-400 mb-4">
              1. Acceptance of Terms
            </h2>
            <p class="text-white/70 mb-4 leading-relaxed">
              By accessing or using the PtahCode desktop application and the
              ptah.live website (collectively, the "Service"), you agree to be
              bound by these Terms of Service ("Terms"). If you do not agree to
              these Terms, you may not use the Service.
            </p>
            <p class="text-white/70 leading-relaxed">
              These Terms constitute a legally binding agreement between you and
              PtahCode ("we," "us," or "our"), operated at
              <a href="https://ptah.live" class="text-amber-400 hover:underline"
                >ptah.live</a
              >.
            </p>
          </section>

          <!-- 2. Description of Service -->
          <section
            id="service-description"
            viewportAnimation
            [viewportConfig]="sectionConfig"
            class="mb-8 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 sm:p-8 backdrop-blur-sm"
          >
            <h2 class="text-2xl font-display font-semibold text-amber-400 mb-4">
              2. Description of Service
            </h2>
            <p class="text-white/70 mb-4 leading-relaxed">
              PtahCode is a free, open-source AI coding orchestration desktop
              application. The Service includes:
            </p>
            <ul
              class="list-disc list-inside text-white/70 space-y-2 ml-4 leading-relaxed"
            >
              <li>
                The PtahCode desktop application with intelligent workspace
                analysis, project-adaptive AI agents, and MCP integration
              </li>
              <li>Desktop downloads through GitHub Releases</li>
              <li>
                Community support through Discord and documentation resources
              </li>
            </ul>
          </section>

          <!-- 3. Accounts and Provider Credentials -->
          <section
            id="accounts-and-credentials"
            viewportAnimation
            [viewportConfig]="sectionConfig"
            class="mb-8 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 sm:p-8 backdrop-blur-sm"
          >
            <h2 class="text-2xl font-display font-semibold text-amber-400 mb-4">
              3. Accounts and Provider Credentials
            </h2>
            <p class="text-white/70 mb-4 leading-relaxed">
              You do not need a ptah.live account to use PtahCode. The desktop
              application connects to the AI providers that you configure.
            </p>
            <p class="text-white/70 mb-4 leading-relaxed">You agree to:</p>
            <ul
              class="list-disc list-inside text-white/70 space-y-2 ml-4 leading-relaxed"
            >
              <li>Keep your provider credentials secure</li>
              <li>Use provider credentials that you are authorized to use</li>
              <li>Follow the terms of each provider that you configure</li>
              <li>Review generated code and commands before you use them</li>
            </ul>
          </section>

          <!-- 4. Open-Source Software -->
          <section
            id="open-source-software"
            viewportAnimation
            [viewportConfig]="sectionConfig"
            class="mb-8 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 sm:p-8 backdrop-blur-sm"
          >
            <h2 class="text-2xl font-display font-semibold text-amber-400 mb-4">
              4. Open-Source Software
            </h2>
            <p class="text-white/70 mb-4 leading-relaxed">
              PtahCode is free and open source. Every desktop capability is
              available at no cost under the license included with the source
              code. No license key, trial, account, or payment is required to
              use the desktop application.
            </p>
            <p class="text-white/70 leading-relaxed">
              The ptah.live website does not sell subscriptions or process
              payments. AI provider usage and related charges are governed by
              your agreements with those providers.
            </p>
          </section>

          <!-- 5. Acceptable Use -->
          <section
            id="acceptable-use"
            viewportAnimation
            [viewportConfig]="sectionConfig"
            class="mb-8 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 sm:p-8 backdrop-blur-sm"
          >
            <h2 class="text-2xl font-display font-semibold text-amber-400 mb-4">
              5. Acceptable Use Policy
            </h2>
            <p class="text-white/70 mb-4 leading-relaxed">
              You agree not to use the Service to:
            </p>
            <ul
              class="list-disc list-inside text-white/70 space-y-2 ml-4 leading-relaxed"
            >
              <li>Violate any applicable laws or regulations</li>
              <li>Use the Service to develop or distribute malicious software</li>
              <li>
                Interfere with or disrupt the integrity or performance of the
                website
              </li>
              <li>
                Attempt to gain unauthorized access to the website or its
                related systems
              </li>
              <li>Violate the terms of an AI provider that you configure</li>
            </ul>
          </section>

          <!-- 7. Intellectual Property -->
          <section
            id="intellectual-property"
            viewportAnimation
            [viewportConfig]="sectionConfig"
            class="mb-8 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 sm:p-8 backdrop-blur-sm"
          >
            <h2 class="text-2xl font-display font-semibold text-amber-400 mb-4">
              6. Intellectual Property Rights
            </h2>
            <p class="text-white/70 mb-4 leading-relaxed">
              The PtahCode source code is available under its open-source
              license. The website design, text, graphics, and other original
              content are owned by PtahCode and protected by intellectual
              property laws.
            </p>
            <p class="text-white/70 leading-relaxed">
              You retain all rights to the code and content you create using the
              Service. We do not claim ownership of any output generated through
              your use of Ptah.
            </p>
          </section>

          <!-- 8. Limitation of Liability -->
          <section
            id="limitation-of-liability"
            viewportAnimation
            [viewportConfig]="sectionConfig"
            class="mb-8 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 sm:p-8 backdrop-blur-sm"
          >
            <h2 class="text-2xl font-display font-semibold text-amber-400 mb-4">
              7. Limitation of Liability
            </h2>
            <p class="text-white/70 mb-4 leading-relaxed">
              To the maximum extent permitted by applicable law, PtahCode
              shall not be liable for any indirect, incidental, special,
              consequential, or punitive damages, including but not limited to
              loss of profits, data, or business opportunities, regardless of
              the cause of action.
            </p>
            <p class="text-white/70 leading-relaxed">
              The Service is provided "as is" and "as available" without
              warranties of any kind, whether express or implied, including but
              not limited to implied warranties of merchantability, fitness for
              a particular purpose, and non-infringement. Some jurisdictions do
              not permit these exclusions, so parts of this section may not
              apply to you.
            </p>
          </section>

          <!-- 9. Termination -->
          <section
            id="termination"
            viewportAnimation
            [viewportConfig]="sectionConfig"
            class="mb-8 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 sm:p-8 backdrop-blur-sm"
          >
            <h2 class="text-2xl font-display font-semibold text-amber-400 mb-4">
              8. Termination
            </h2>
            <p class="text-white/70 mb-4 leading-relaxed">
              We may restrict access to the website if you violate these Terms
              or engage in conduct that harms the website or other users.
            </p>
            <p class="text-white/70 leading-relaxed">
              You may stop using PtahCode at any time by closing and
              uninstalling the desktop application. You can delete its local
              settings and credentials through your operating system.
            </p>
          </section>

          <!-- 10. Changes to Terms -->
          <section
            id="changes"
            viewportAnimation
            [viewportConfig]="sectionConfig"
            class="mb-8 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 sm:p-8 backdrop-blur-sm"
          >
            <h2 class="text-2xl font-display font-semibold text-amber-400 mb-4">
              9. Changes to Terms
            </h2>
            <p class="text-white/70 leading-relaxed">
              We reserve the right to modify these Terms at any time. We will
              notify you of material changes by posting the updated Terms on our
              website and updating the "Last Updated" date. Your continued use
              of the Service after changes are posted constitutes acceptance of
              the revised Terms.
            </p>
          </section>

          <!-- 11. Governing Law -->
          <section
            id="governing-law"
            viewportAnimation
            [viewportConfig]="sectionConfig"
            class="mb-8 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 sm:p-8 backdrop-blur-sm"
          >
            <h2 class="text-2xl font-display font-semibold text-amber-400 mb-4">
              10. Governing Law
            </h2>
            <p class="text-white/70 leading-relaxed">
              These Terms shall be governed by and construed in accordance with
              applicable law. Any disputes arising from these Terms or your use
              of the Service shall be resolved through good-faith negotiation.
              If a resolution cannot be reached, disputes shall be submitted to
              binding arbitration.
            </p>
          </section>

          <!-- 12. Contact -->
          <section
            id="contact"
            viewportAnimation
            [viewportConfig]="sectionConfig"
            class="mb-8 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 sm:p-8 backdrop-blur-sm"
          >
            <h2 class="text-2xl font-display font-semibold text-amber-400 mb-4">
              11. Contact Information
            </h2>
            <p class="text-white/70 leading-relaxed">
              If you have questions about these Terms, please contact us:
            </p>
            <ul
              class="list-disc list-inside text-white/70 space-y-2 ml-4 mt-4 leading-relaxed"
            >
              <li>
                Email:
                <a
                  href="mailto:support@ptah.live"
                  class="text-amber-400 hover:underline"
                  >support&#64;ptah.live</a
                >
              </li>
              <li>
                Website:
                <a
                  href="https://ptah.live"
                  class="text-amber-400 hover:underline"
                  >ptah.live</a
                >
              </li>
              <li>
                Community:
                <a
                  href="https://discord.gg/pZcbrqNRzq"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-amber-400 hover:underline"
                  >Discord</a
                >
              </li>
            </ul>
          </section>
        </div>
      </main>

      <ptah-footer />
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        contain: layout style;
      }
    `,
  ],
})
export class TermsPageComponent {
  constructor() {
    inject(SeoService).setPage({
      title: 'Terms and Conditions — PtahCode',
      description:
        'Terms of service for the free, open-source PtahCode desktop application and website.',
      url: 'https://ptah.live/terms-and-conditions',
    });
  }

  public readonly headerConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.8,
    delay: 0.1,
    ease: 'power2.out',
  };

  public readonly sectionConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.6,
    threshold: 0.1,
  };
}

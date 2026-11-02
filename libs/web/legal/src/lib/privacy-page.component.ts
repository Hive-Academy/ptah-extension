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
  selector: 'ptah-privacy-page',
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
              Privacy Policy
            </h1>
            <p class="text-white/40">Last Updated: November 2026</p>
          </div>

          <!-- 1. Introduction -->
          <section
            id="introduction"
            viewportAnimation
            [viewportConfig]="sectionConfig"
            class="mb-8 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 sm:p-8 backdrop-blur-sm"
          >
            <h2 class="text-2xl font-display font-semibold text-amber-400 mb-4">
              1. Introduction
            </h2>
            <p class="text-white/70 mb-4 leading-relaxed">
              PtahCode ("we," "us," or "our") provides the PtahCode desktop
              application and the website
              <a href="https://ptah.live" class="text-amber-400 hover:underline"
                >ptah.live</a
              >
              (collectively, the "Service"). This Privacy Policy explains how we
              collect, use, and protect your personal information when you use
              our Service.
            </p>
            <p class="text-white/70 leading-relaxed">
              By using the Service, you consent to the practices described in
              this Privacy Policy.
            </p>
          </section>

          <!-- 2. Information We Collect -->
          <section
            id="data-collection"
            viewportAnimation
            [viewportConfig]="sectionConfig"
            class="mb-8 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 sm:p-8 backdrop-blur-sm"
          >
            <h2 class="text-2xl font-display font-semibold text-amber-400 mb-4">
              2. Information We Collect
            </h2>

            <h3 class="text-lg font-semibold text-white/90 mb-3">
              2.1 Information You Provide
            </h3>
            <p class="text-white/70 mb-6 leading-relaxed">
              When you contact us for support, we receive your email address and
              the information you include in your message. Do not include API
              keys, passwords, or other secrets in support requests.
            </p>

            <h3 class="text-lg font-semibold text-white/90 mb-3">
              2.2 Local Application Data
            </h3>
            <p class="text-white/70 mb-6 leading-relaxed">
              PtahCode stores workspace settings and provider credentials on
              your device. Provider credentials go directly to the AI providers
              you configure. We do not receive those credentials through the
              ptah.live website.
            </p>

            <h3 class="text-lg font-semibold text-white/90 mb-3">
              2.3 Website Data
            </h3>
            <p class="text-white/70 mb-4 leading-relaxed">
              The website does not provide accounts, checkout, or waitlist
              registration. Our hosting provider can process standard technical
              logs, including:
            </p>
            <ul
              class="list-disc list-inside text-white/70 space-y-2 ml-4 mb-6 leading-relaxed"
            >
              <li>IP address and browser information</li>
              <li>Requested pages and timestamps</li>
              <li>Error reports and performance metrics</li>
            </ul>

            <h3 class="text-lg font-semibold text-white/90 mb-3">
              2.4 Download Data
            </h3>
            <p class="text-white/70 leading-relaxed">
              Desktop downloads are hosted by GitHub Releases. When you download
              PtahCode, GitHub processes technical data under its own privacy
              policy.
            </p>
          </section>

          <!-- 3. How We Use Information -->
          <section
            id="data-usage"
            viewportAnimation
            [viewportConfig]="sectionConfig"
            class="mb-8 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 sm:p-8 backdrop-blur-sm"
          >
            <h2 class="text-2xl font-display font-semibold text-amber-400 mb-4">
              3. How We Use Your Information
            </h2>
            <p class="text-white/70 mb-4 leading-relaxed">
              We use the information we collect to:
            </p>
            <ul
              class="list-disc list-inside text-white/70 space-y-2 ml-4 leading-relaxed"
            >
              <li>Provide, maintain, and improve the Service</li>
              <li>Respond to support requests and inquiries</li>
              <li>Protect the website and its users from abuse</li>
              <li>Analyze technical logs to improve reliability</li>
              <li>Comply with legal obligations</li>
            </ul>
          </section>

          <!-- 4. Third-Party Services -->
          <section
            id="third-party-services"
            viewportAnimation
            [viewportConfig]="sectionConfig"
            class="mb-8 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 sm:p-8 backdrop-blur-sm"
          >
            <h2 class="text-2xl font-display font-semibold text-amber-400 mb-4">
              4. Third-Party Services
            </h2>
            <p class="text-white/70 mb-4 leading-relaxed">
              We use the following third-party services that may process your
              data:
            </p>
            <ul
              class="list-disc list-inside text-white/70 space-y-2 ml-4 leading-relaxed"
            >
              <li>
                <strong class="text-white/90">GitHub</strong> (github.com) --
                Source code, releases, and desktop downloads
              </li>
              <li>
                <strong class="text-white/90">DigitalOcean</strong>
                (digitalocean.com) -- Website hosting and technical logs
              </li>
              <li>
                <strong class="text-white/90">Discord</strong> (discord.com) --
                Community support and communication (voluntary participation)
              </li>
              <li>
                <strong class="text-white/90">AI providers</strong> -- Provider
                credentials and prompts sent only when you configure and use a
                provider in the desktop application
              </li>
            </ul>
            <p class="text-white/70 mt-4 leading-relaxed">
              Each third-party service operates under its own privacy policy. We
              encourage you to review their policies for details on how they
              handle your data.
            </p>
          </section>

          <!-- 5. Data Retention -->
          <section
            id="data-retention"
            viewportAnimation
            [viewportConfig]="sectionConfig"
            class="mb-8 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 sm:p-8 backdrop-blur-sm"
          >
            <h2 class="text-2xl font-display font-semibold text-amber-400 mb-4">
              5. Data Retention
            </h2>
            <p class="text-white/70 mb-4 leading-relaxed">
              We retain personal data only as needed for the purposes described
              in this policy:
            </p>
            <ul
              class="list-disc list-inside text-white/70 space-y-2 ml-4 leading-relaxed"
            >
              <li>
                <strong class="text-white/90">Support correspondence</strong> is
                retained as needed to respond and maintain support records
              </li>
              <li>
                <strong class="text-white/90">Technical logs</strong> are
                retained according to our hosting provider's policies
              </li>
              <li>
                <strong class="text-white/90">Local application data</strong>
                remains on your device until you delete it or uninstall the
                application
              </li>
            </ul>
          </section>

          <!-- 6. User Rights -->
          <section
            id="user-rights"
            viewportAnimation
            [viewportConfig]="sectionConfig"
            class="mb-8 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 sm:p-8 backdrop-blur-sm"
          >
            <h2 class="text-2xl font-display font-semibold text-amber-400 mb-4">
              6. Your Rights
            </h2>
            <p class="text-white/70 mb-4 leading-relaxed">
              You have the following rights regarding your personal data:
            </p>
            <ul
              class="list-disc list-inside text-white/70 space-y-2 ml-4 leading-relaxed"
            >
              <li>
                <strong class="text-white/90">Access</strong> -- Request a copy
                of the personal data we hold about you
              </li>
              <li>
                <strong class="text-white/90">Correction</strong> -- Request
                correction of inaccurate personal data
              </li>
              <li>
                <strong class="text-white/90">Deletion</strong> -- Request
                deletion of your personal data
              </li>
              <li>
                <strong class="text-white/90">Portability</strong> -- Request
                your data in a structured, machine-readable format
              </li>
              <li>
                <strong class="text-white/90">Objection</strong> -- Object to
                processing of your personal data for certain purposes
              </li>
            </ul>
            <p class="text-white/70 mt-4 leading-relaxed">
              To exercise any of these rights, contact us at
              <a
                href="mailto:support@ptah.live"
                class="text-amber-400 hover:underline"
                >support&#64;ptah.live</a
              >. We will respond to your request within 30 days.
            </p>
          </section>

          <!-- 7. Cookies and Tracking -->
          <section
            id="cookies"
            viewportAnimation
            [viewportConfig]="sectionConfig"
            class="mb-8 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 sm:p-8 backdrop-blur-sm"
          >
            <h2 class="text-2xl font-display font-semibold text-amber-400 mb-4">
              7. Cookies and Tracking
            </h2>
            <p class="text-white/70 mb-4 leading-relaxed">
              The PtahCode desktop application stores preferences and provider
              settings locally on your device. The website does not use cookies
              for accounts, checkout, or waitlist registration.
            </p>
            <p class="text-white/70 mt-4 leading-relaxed">
              We do not use third-party advertising cookies or cross-site
              tracking. Our hosting provider can use necessary technical cookies
              for security and reliability.
            </p>
          </section>

          <!-- 8. Children's Privacy -->
          <section
            id="children"
            viewportAnimation
            [viewportConfig]="sectionConfig"
            class="mb-8 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 sm:p-8 backdrop-blur-sm"
          >
            <h2 class="text-2xl font-display font-semibold text-amber-400 mb-4">
              8. Children's Privacy
            </h2>
            <p class="text-white/70 leading-relaxed">
              The Service is not intended for children under the age of 13. We
              do not knowingly collect personal information from children under
              13. If we discover that we have collected personal information
              from a child under 13, we will promptly delete that information.
              If you believe a child under 13 has provided us with personal
              information, please contact us at
              <a
                href="mailto:support@ptah.live"
                class="text-amber-400 hover:underline"
                >support&#64;ptah.live</a
              >.
            </p>
          </section>

          <!-- 9. International Data Transfers -->
          <section
            id="international-transfers"
            viewportAnimation
            [viewportConfig]="sectionConfig"
            class="mb-8 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 sm:p-8 backdrop-blur-sm"
          >
            <h2 class="text-2xl font-display font-semibold text-amber-400 mb-4">
              9. International Data Transfers
            </h2>
            <p class="text-white/70 leading-relaxed">
              Your data may be processed and stored in locations outside your
              country of residence. Our website hosting, GitHub, Discord, and
              the AI providers you select can process data in other countries.
              We take reasonable measures to protect data that we control in
              accordance with this Privacy Policy.
            </p>
          </section>

          <!-- 10. GDPR -->
          <section
            id="gdpr"
            viewportAnimation
            [viewportConfig]="sectionConfig"
            class="mb-8 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 sm:p-8 backdrop-blur-sm"
          >
            <h2 class="text-2xl font-display font-semibold text-amber-400 mb-4">
              10. GDPR Compliance
            </h2>
            <p class="text-white/70 leading-relaxed">
              For users in the European Economic Area (EEA), we process personal
              data based on legitimate interest in operating and securing the
              Service. We process support correspondence to respond to your
              requests. You may exercise your GDPR rights as described in
              Section 6 above.
            </p>
          </section>

          <!-- 11. Changes -->
          <section
            id="changes"
            viewportAnimation
            [viewportConfig]="sectionConfig"
            class="mb-8 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 sm:p-8 backdrop-blur-sm"
          >
            <h2 class="text-2xl font-display font-semibold text-amber-400 mb-4">
              11. Changes to This Privacy Policy
            </h2>
            <p class="text-white/70 leading-relaxed">
              We may update this Privacy Policy from time to time. We will
              notify you of material changes by posting the updated policy on
              our website and updating the "Last Updated" date. Your continued
              use of the Service after changes are posted constitutes acceptance
              of the revised policy.
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
              12. Contact Information
            </h2>
            <p class="text-white/70 leading-relaxed">
              If you have questions or concerns about this Privacy Policy or our
              data practices, please contact us:
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
export class PrivacyPageComponent {
  constructor() {
    inject(SeoService).setPage({
      title: 'Privacy Policy — PtahCode',
      description:
        'How PtahCode handles website support data and local desktop application data.',
      url: 'https://ptah.live/privacy',
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

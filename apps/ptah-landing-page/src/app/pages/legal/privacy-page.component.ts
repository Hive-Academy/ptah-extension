import { Component, ChangeDetectionStrategy } from '@angular/core';
import {
  ViewportAnimationDirective,
  ViewportAnimationConfig,
} from '@hive-academy/angular-gsap';
import { NavigationComponent } from '../../components/navigation.component';
import { FooterComponent } from '../../components/footer.component';
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
            <p class="text-white/40">Last Updated: March 2026</p>
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
              Ptah Extension ("we," "us," or "our") operates the Ptah VS Code
              extension and the website
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
              2.1 Account Information
            </h3>
            <p class="text-white/70 mb-4 leading-relaxed">
              When you create an account, we collect information through our
              authentication provider, WorkOS:
            </p>
            <ul
              class="list-disc list-inside text-white/70 space-y-2 ml-4 mb-6 leading-relaxed"
            >
              <li>Email address</li>
              <li>Display name</li>
              <li>Authentication tokens (managed securely by WorkOS)</li>
            </ul>

            <h3 class="text-lg font-semibold text-white/90 mb-3">
              2.2 Payment Information
            </h3>
            <p class="text-white/70 mb-6 leading-relaxed">
              Payment data (credit card numbers, billing addresses) is collected
              and processed entirely by
              <strong class="text-white/90">Paddle</strong> (paddle.com), our
              merchant of record. We do not store or have direct access to your
              full payment details. We receive only transaction confirmations,
              subscription status, and invoice references from Paddle.
            </p>

            <h3 class="text-lg font-semibold text-white/90 mb-3">
              2.3 Usage Data
            </h3>
            <p class="text-white/70 mb-4 leading-relaxed">
              We collect anonymized usage analytics to improve the Service,
              including:
            </p>
            <ul
              class="list-disc list-inside text-white/70 space-y-2 ml-4 mb-6 leading-relaxed"
            >
              <li>Feature usage patterns within the VS Code extension</li>
              <li>Session duration and frequency</li>
              <li>Error reports and performance metrics</li>
            </ul>

            <h3 class="text-lg font-semibold text-white/90 mb-3">
              2.4 License Data
            </h3>
            <p class="text-white/70 leading-relaxed">
              We store license keys and subscription status to validate your
              access to Pro features. This data is linked to your account and
              managed through our license server.
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
              <li>Manage your account and process subscription transactions</li>
              <li>Validate license keys and enforce subscription plans</li>
              <li>
                Send important service notifications (security alerts, billing
                updates, trial expiration reminders)
              </li>
              <li>
                Analyze usage patterns to improve features and performance
              </li>
              <li>Respond to support requests and inquiries</li>
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
                <strong class="text-white/90">Paddle</strong> (paddle.com) --
                Payment processing, invoicing, VAT/sales tax handling as
                merchant of record
              </li>
              <li>
                <strong class="text-white/90">WorkOS</strong> (workos.com) --
                Authentication, single sign-on (SSO), and magic link login
              </li>
              <li>
                <strong class="text-white/90">DigitalOcean</strong>
                (digitalocean.com) -- Server hosting and infrastructure for our
                license server and API
              </li>
              <li>
                <strong class="text-white/90">Discord</strong> (discord.com) --
                Community support and communication (voluntary participation)
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
              We retain your personal data for as long as your account is active
              or as needed to provide the Service. Specifically:
            </p>
            <ul
              class="list-disc list-inside text-white/70 space-y-2 ml-4 leading-relaxed"
            >
              <li>
                <strong class="text-white/90">Account data</strong> is retained
                until you request account deletion
              </li>
              <li>
                <strong class="text-white/90">Usage analytics</strong> are
                retained in anonymized form and may be kept indefinitely
              </li>
              <li>
                <strong class="text-white/90">Transaction records</strong> are
                retained as required by applicable tax and accounting laws
              </li>
              <li>
                <strong class="text-white/90">License records</strong> are
                deleted upon account deletion
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
                deletion of your personal data and account
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
              Our website uses essential cookies to:
            </p>
            <ul
              class="list-disc list-inside text-white/70 space-y-2 ml-4 leading-relaxed"
            >
              <li>Maintain your authentication session</li>
              <li>Remember your preferences</li>
              <li>Ensure the security of your account</li>
            </ul>
            <p class="text-white/70 mt-4 leading-relaxed">
              We do not use third-party advertising cookies or cross-site
              tracking. Analytics data is collected in anonymized form to
              improve the Service.
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
              country of residence. Our servers are hosted on DigitalOcean
              infrastructure. Paddle, as our merchant of record, handles EU GDPR
              compliance for payment-related data and manages VAT/sales tax
              obligations across jurisdictions. We take reasonable measures to
              ensure your data is treated securely and in accordance with this
              Privacy Policy regardless of where it is processed.
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
              data based on legitimate interest (providing and improving the
              Service) and contractual necessity (fulfilling your subscription).
              Paddle, as our merchant of record, independently handles GDPR
              compliance for all payment processing and related data. You may
              exercise your GDPR rights as described in Section 6 above.
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

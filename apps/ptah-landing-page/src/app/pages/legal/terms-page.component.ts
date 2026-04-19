import { Component, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  ViewportAnimationDirective,
  ViewportAnimationConfig,
} from '@hive-academy/angular-gsap';
import { NavigationComponent } from '../../components/navigation.component';
import { FooterComponent } from '../../components/footer.component';
import { FallingCubesBackgroundComponent } from './components/falling-cubes-background.component';

@Component({
  selector: 'ptah-terms-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NavigationComponent,
    FooterComponent,
    RouterLink,
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
            <p class="text-white/40">Last Updated: March 2026</p>
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
              By accessing or using the Ptah VS Code extension and related
              services (collectively, the "Service"), you agree to be bound by
              these Terms of Service ("Terms"). If you do not agree to these
              Terms, you may not use the Service.
            </p>
            <p class="text-white/70 leading-relaxed">
              These Terms constitute a legally binding agreement between you and
              Ptah Extension ("we," "us," or "our"), operated at
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
              Ptah is an AI coding orchestra for Visual Studio Code. The Service
              includes:
            </p>
            <ul
              class="list-disc list-inside text-white/70 space-y-2 ml-4 leading-relaxed"
            >
              <li>
                The Ptah VS Code extension providing intelligent workspace
                analysis, project-adaptive AI agents, and built-in MCP server
                integration
              </li>
              <li>
                Cloud-based license management and subscription services hosted
                at ptah.live
              </li>
              <li>
                Community support through Discord and documentation resources
              </li>
            </ul>
          </section>

          <!-- 3. Account Registration -->
          <section
            id="account-registration"
            viewportAnimation
            [viewportConfig]="sectionConfig"
            class="mb-8 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 sm:p-8 backdrop-blur-sm"
          >
            <h2 class="text-2xl font-display font-semibold text-amber-400 mb-4">
              3. Account Registration and Security
            </h2>
            <p class="text-white/70 mb-4 leading-relaxed">
              To access certain features, you must create an account.
              Authentication is handled through our third-party provider,
              WorkOS, which supports single sign-on (SSO) and magic link
              authentication.
            </p>
            <p class="text-white/70 mb-4 leading-relaxed">You agree to:</p>
            <ul
              class="list-disc list-inside text-white/70 space-y-2 ml-4 leading-relaxed"
            >
              <li>
                Provide accurate and complete information during registration
              </li>
              <li>Maintain the security of your account credentials</li>
              <li>
                Notify us immediately of any unauthorized access to your account
              </li>
              <li>
                Accept responsibility for all activity that occurs under your
                account
              </li>
            </ul>
          </section>

          <!-- 4. Subscription Plans -->
          <section
            id="subscription-plans"
            viewportAnimation
            [viewportConfig]="sectionConfig"
            class="mb-8 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 sm:p-8 backdrop-blur-sm"
          >
            <h2 class="text-2xl font-display font-semibold text-amber-400 mb-4">
              4. Subscription Plans and Billing
            </h2>
            <p class="text-white/70 mb-4 leading-relaxed">
              Ptah offers the following plans:
            </p>
            <ul
              class="list-disc list-inside text-white/70 space-y-2 ml-4 mb-4 leading-relaxed"
            >
              <li>
                <strong class="text-white/90">Community (Free)</strong> -- Basic
                features at no cost
              </li>
              <li>
                <strong class="text-white/90"
                  >Pro ($5/month or $50/year)</strong
                >
                -- Full access to all features, including a 100-day free trial
              </li>
            </ul>
            <p class="text-white/70 mb-4 leading-relaxed">
              All payments are processed by
              <strong class="text-white/90">Paddle</strong> (paddle.com), which
              serves as our merchant of record. Paddle handles all payment
              processing, invoicing, VAT, and sales tax on our behalf. By
              subscribing, you also agree to Paddle's terms of service.
            </p>
            <p class="text-white/70 leading-relaxed">
              Subscriptions automatically renew at the end of each billing
              period. You may cancel your subscription at any time through your
              account settings or by contacting us. Cancellation takes effect at
              the end of the current billing period.
            </p>
          </section>

          <!-- 5. Free Trial -->
          <section
            id="free-trial"
            viewportAnimation
            [viewportConfig]="sectionConfig"
            class="mb-8 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 sm:p-8 backdrop-blur-sm"
          >
            <h2 class="text-2xl font-display font-semibold text-amber-400 mb-4">
              5. Free Trial
            </h2>
            <p class="text-white/70 mb-4 leading-relaxed">
              The Pro plan includes a 100-day free trial. No payment information
              is required to start the trial. At the end of the trial period:
            </p>
            <ul
              class="list-disc list-inside text-white/70 space-y-2 ml-4 leading-relaxed"
            >
              <li>
                If you choose to subscribe, your selected payment method will be
                charged
              </li>
              <li>
                If you do not subscribe, your account will revert to the
                Community (free) plan
              </li>
              <li>Free trials are limited to one per user</li>
            </ul>
          </section>

          <!-- 6. Acceptable Use -->
          <section
            id="acceptable-use"
            viewportAnimation
            [viewportConfig]="sectionConfig"
            class="mb-8 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 sm:p-8 backdrop-blur-sm"
          >
            <h2 class="text-2xl font-display font-semibold text-amber-400 mb-4">
              6. Acceptable Use Policy
            </h2>
            <p class="text-white/70 mb-4 leading-relaxed">
              You agree not to use the Service to:
            </p>
            <ul
              class="list-disc list-inside text-white/70 space-y-2 ml-4 leading-relaxed"
            >
              <li>Violate any applicable laws or regulations</li>
              <li>
                Reverse engineer, decompile, or attempt to extract the source
                code of the Service
              </li>
              <li>
                Share, transfer, or resell your license or account credentials
              </li>
              <li>
                Interfere with or disrupt the integrity or performance of the
                Service
              </li>
              <li>
                Attempt to gain unauthorized access to the Service or its
                related systems
              </li>
              <li>Use the Service to develop a competing product or service</li>
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
              7. Intellectual Property Rights
            </h2>
            <p class="text-white/70 mb-4 leading-relaxed">
              The Service, including all software, design, text, graphics, and
              other content, is owned by Ptah Extension and protected by
              intellectual property laws. Your subscription grants you a
              limited, non-exclusive, non-transferable license to use the
              Service.
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
              8. Limitation of Liability
            </h2>
            <p class="text-white/70 mb-4 leading-relaxed">
              To the maximum extent permitted by applicable law, Ptah Extension
              shall not be liable for any indirect, incidental, special,
              consequential, or punitive damages, including but not limited to
              loss of profits, data, or business opportunities, regardless of
              the cause of action.
            </p>
            <p class="text-white/70 leading-relaxed">
              The Service is provided "as is" and "as available" without
              warranties of any kind, whether express or implied, including but
              not limited to implied warranties of merchantability, fitness for
              a particular purpose, and non-infringement. Our total liability
              shall not exceed the amount you paid us in the twelve (12) months
              preceding the claim.
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
              9. Termination
            </h2>
            <p class="text-white/70 mb-4 leading-relaxed">
              We may suspend or terminate your access to the Service at any time
              if you violate these Terms or engage in conduct that we determine
              to be harmful to the Service or other users.
            </p>
            <p class="text-white/70 leading-relaxed">
              You may terminate your account at any time by contacting us at
              <a
                href="mailto:support@ptah.live"
                class="text-amber-400 hover:underline"
                >support&#64;ptah.live</a
              >. Upon termination, your right to use the Service will
              immediately cease. Any prepaid fees for unused subscription
              periods may be refunded in accordance with our
              <a routerLink="/refund" class="text-amber-400 hover:underline"
                >Refund Policy</a
              >.
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
              10. Changes to Terms
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
              11. Governing Law
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
              12. Contact Information
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

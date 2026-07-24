import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { SeoService } from '../../services/seo.service';
import { RouterLink } from '@angular/router';
import {
  ViewportAnimationDirective,
  ViewportAnimationConfig,
} from '@hive-academy/angular-gsap';
import { NavigationComponent } from '../../components/navigation.component';
import { FooterComponent } from '../../components/footer.component';
import { FallingCubesBackgroundComponent } from './components/falling-cubes-background.component';

@Component({
  selector: 'ptah-refund-page',
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
              Refund Policy
            </h1>
            <p class="text-white/40">Last Updated: July 2026</p>
          </div>

          <!-- 1. Scope of This Policy -->
          <section
            id="scope"
            viewportAnimation
            [viewportConfig]="sectionConfig"
            class="mb-8 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 sm:p-8 backdrop-blur-sm"
          >
            <h2 class="text-2xl font-display font-semibold text-amber-400 mb-4">
              1. Scope of This Policy
            </h2>
            <p class="text-white/70 mb-4 leading-relaxed">
              Ptah is free and open source -- the full coding orchestra works
              without any payment, for free, forever. This Refund Policy only
              applies to money actually charged for a paid
              <strong class="text-white/90">Ptah Builders</strong>
              membership.
            </p>
          </section>

          <!-- 2. Refund Eligibility -->
          <section
            id="refund-eligibility"
            viewportAnimation
            [viewportConfig]="sectionConfig"
            class="mb-8 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 sm:p-8 backdrop-blur-sm"
          >
            <h2 class="text-2xl font-display font-semibold text-amber-400 mb-4">
              2. Refund Eligibility
            </h2>
            <p class="text-white/70 mb-4 leading-relaxed">
              We want you to be satisfied with Ptah Builders. Your
              <strong class="text-white/90">first charge</strong> -- whether
              monthly or yearly -- is covered by a
              <strong class="text-white/90">30-day money-back guarantee</strong
              >: if it doesn't meet your expectations, request a full refund
              within 30 days of that first payment, no questions asked.
            </p>
            <p class="text-white/70 leading-relaxed">
              <strong class="text-white/90"
                >Renewals are non-refundable.</strong
              >
              Once your first 30-day window has passed, subsequent billing
              cycles (monthly or annual renewals) are not eligible for a refund.
              You can cancel at any time to stop future renewals -- see Section
              5 below.
            </p>
          </section>

          <!-- 3. How to Request -->
          <section
            id="how-to-request"
            viewportAnimation
            [viewportConfig]="sectionConfig"
            class="mb-8 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 sm:p-8 backdrop-blur-sm"
          >
            <h2 class="text-2xl font-display font-semibold text-amber-400 mb-4">
              3. How to Request a Refund
            </h2>
            <p class="text-white/70 mb-4 leading-relaxed">
              To request a refund, contact us through one of the following
              channels:
            </p>
            <ul
              class="list-disc list-inside text-white/70 space-y-2 ml-4 leading-relaxed"
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
                Discord:
                <a
                  href="https://discord.gg/pZcbrqNRzq"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-amber-400 hover:underline"
                  >Join our server</a
                >
                and open a support ticket
              </li>
            </ul>
            <p class="text-white/70 mt-4 leading-relaxed">
              Please include your account email address and the reason for your
              refund request. We aim to respond to all refund requests within 2
              business days.
            </p>
          </section>

          <!-- 4. Paddle -->
          <section
            id="payment-processing"
            viewportAnimation
            [viewportConfig]="sectionConfig"
            class="mb-8 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 sm:p-8 backdrop-blur-sm"
          >
            <h2 class="text-2xl font-display font-semibold text-amber-400 mb-4">
              4. Payment Processing
            </h2>
            <p class="text-white/70 leading-relaxed">
              All payments and refunds are processed through
              <strong class="text-white/90">Paddle</strong> (paddle.com), our
              merchant of record. Paddle handles all payment processing,
              invoicing, and tax compliance. Once a refund is approved, it will
              be processed by Paddle and returned to your original payment
              method. Paddle's refund processing is subject to their own terms
              and policies.
            </p>
          </section>

          <!-- 5. Non-Refundable -->
          <section
            id="non-refundable"
            viewportAnimation
            [viewportConfig]="sectionConfig"
            class="mb-8 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 sm:p-8 backdrop-blur-sm"
          >
            <h2 class="text-2xl font-display font-semibold text-amber-400 mb-4">
              5. Non-Refundable Scenarios
            </h2>
            <p class="text-white/70 mb-4 leading-relaxed">
              Refunds will not be issued in the following cases:
            </p>
            <ul
              class="list-disc list-inside text-white/70 space-y-2 ml-4 leading-relaxed"
            >
              <li>Requests made more than 30 days after your first payment</li>
              <li>
                Any renewal charge (monthly or annual) after the first billing
                cycle -- renewals are non-refundable, though you can cancel
                anytime to stop future charges
              </li>
              <li>
                Accounts terminated due to violations of our
                <a
                  routerLink="/terms-and-conditions"
                  class="text-amber-400 hover:underline"
                  >Terms of Service</a
                >
              </li>
              <li>Requests from users who have previously received a refund</li>
            </ul>
          </section>

          <!-- 6. Processing Time -->
          <section
            id="processing-time"
            viewportAnimation
            [viewportConfig]="sectionConfig"
            class="mb-8 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 sm:p-8 backdrop-blur-sm"
          >
            <h2 class="text-2xl font-display font-semibold text-amber-400 mb-4">
              6. Processing Time
            </h2>
            <p class="text-white/70 leading-relaxed">
              Once a refund is approved, it typically takes
              <strong class="text-white/90">5 to 10 business days</strong> for
              the refund to appear on your statement, depending on your payment
              provider and financial institution. Paddle will send you a
              confirmation email once the refund has been processed.
            </p>
          </section>

          <!-- 7. Contact -->
          <section
            id="contact"
            viewportAnimation
            [viewportConfig]="sectionConfig"
            class="mb-8 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 sm:p-8 backdrop-blur-sm"
          >
            <h2 class="text-2xl font-display font-semibold text-amber-400 mb-4">
              7. Contact Information
            </h2>
            <p class="text-white/70 leading-relaxed">
              If you have questions about our refund policy, please contact us:
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
export class RefundPageComponent {
  constructor() {
    inject(SeoService).setPage({
      title: 'Refund Policy — Ptah',
      description:
        'Refund terms for Ptah Builders membership billing: a 30-day money-back guarantee on your first charge, processed through Paddle.',
      url: 'https://ptah.live/refund',
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

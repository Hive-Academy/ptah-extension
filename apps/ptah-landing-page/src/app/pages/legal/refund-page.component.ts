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
            <p class="text-white/40">Last Updated: March 2026</p>
          </div>

          <!-- 1. Free Trial -->
          <section
            id="free-trial"
            viewportAnimation
            [viewportConfig]="sectionConfig"
            class="mb-8 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 sm:p-8 backdrop-blur-sm"
          >
            <h2 class="text-2xl font-display font-semibold text-amber-400 mb-4">
              1. Free Trial
            </h2>
            <p class="text-white/70 mb-4 leading-relaxed">
              Ptah Pro includes a
              <strong class="text-white/90">30-day free trial</strong>. During
              the trial period:
            </p>
            <ul
              class="list-disc list-inside text-white/70 space-y-2 ml-4 leading-relaxed"
            >
              <li>No payment information is required to start the trial</li>
              <li>You have full access to all Pro features</li>
              <li>
                At the end of the trial, you can choose to subscribe or your
                account will revert to the Community (free) plan
              </li>
              <li>No charges are made during the trial period</li>
            </ul>
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
              We want you to be satisfied with Ptah. If the Service does not
              meet your expectations, you may request a refund under the
              following conditions:
            </p>
            <ul
              class="list-disc list-inside text-white/70 space-y-2 ml-4 leading-relaxed"
            >
              <li>
                <strong class="text-white/90">Monthly plans:</strong> Refund
                requests must be submitted within
                <strong class="text-white/90">14 days</strong> of your first
                payment
              </li>
              <li>
                <strong class="text-white/90">Annual plans:</strong> Refund
                requests must be submitted within
                <strong class="text-white/90">14 days</strong> of your first
                payment for a full refund, or a pro-rated refund may be issued
                for unused months if requested within the first 3 months
              </li>
            </ul>
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

          <!-- 5. Pro-Rated Refunds -->
          <section
            id="pro-rated-refunds"
            viewportAnimation
            [viewportConfig]="sectionConfig"
            class="mb-8 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 sm:p-8 backdrop-blur-sm"
          >
            <h2 class="text-2xl font-display font-semibold text-amber-400 mb-4">
              5. Pro-Rated Refunds for Annual Plans
            </h2>
            <p class="text-white/70 mb-4 leading-relaxed">
              If you are on an annual plan and request a refund after the
              initial 14-day window but within the first 3 months:
            </p>
            <ul
              class="list-disc list-inside text-white/70 space-y-2 ml-4 leading-relaxed"
            >
              <li>
                A pro-rated refund will be calculated based on the remaining
                unused months of your subscription
              </li>
              <li>
                The refund amount will be the annual fee minus the cost of
                months used at the monthly rate ($5/month)
              </li>
              <li>
                Pro-rated refunds are issued at our discretion and evaluated on
                a case-by-case basis
              </li>
            </ul>
          </section>

          <!-- 6. Non-Refundable -->
          <section
            id="non-refundable"
            viewportAnimation
            [viewportConfig]="sectionConfig"
            class="mb-8 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 sm:p-8 backdrop-blur-sm"
          >
            <h2 class="text-2xl font-display font-semibold text-amber-400 mb-4">
              6. Non-Refundable Scenarios
            </h2>
            <p class="text-white/70 mb-4 leading-relaxed">
              Refunds will not be issued in the following cases:
            </p>
            <ul
              class="list-disc list-inside text-white/70 space-y-2 ml-4 leading-relaxed"
            >
              <li>
                Requests made more than 14 days after payment (for monthly
                plans) or more than 3 months after payment (for annual plans)
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
              <li>
                Failure to cancel before the next billing cycle (unused
                subscription time after a billing renewal)
              </li>
            </ul>
          </section>

          <!-- 7. Processing Time -->
          <section
            id="processing-time"
            viewportAnimation
            [viewportConfig]="sectionConfig"
            class="mb-8 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 sm:p-8 backdrop-blur-sm"
          >
            <h2 class="text-2xl font-display font-semibold text-amber-400 mb-4">
              7. Processing Time
            </h2>
            <p class="text-white/70 leading-relaxed">
              Once a refund is approved, it typically takes
              <strong class="text-white/90">5 to 10 business days</strong> for
              the refund to appear on your statement, depending on your payment
              provider and financial institution. Paddle will send you a
              confirmation email once the refund has been processed.
            </p>
          </section>

          <!-- 8. Contact -->
          <section
            id="contact"
            viewportAnimation
            [viewportConfig]="sectionConfig"
            class="mb-8 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 sm:p-8 backdrop-blur-sm"
          >
            <h2 class="text-2xl font-display font-semibold text-amber-400 mb-4">
              8. Contact Information
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

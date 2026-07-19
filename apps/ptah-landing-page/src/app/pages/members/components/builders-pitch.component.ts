import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  BookOpen,
  Check,
  GraduationCap,
  LifeBuoy,
  LucideAngularModule,
  Package,
  Sparkles,
  Zap,
} from 'lucide-angular';

/** Every lucide icon export shares this structural type. */
type IconRef = typeof GraduationCap;

interface ValueProp {
  readonly icon: IconRef;
  readonly title: string;
}

/**
 * BuildersPitchComponent — shown on `/members` to authenticated non-Builders
 * viewers instead of a dead-end after the `GET /api/v1/members/sessions`
 * 403 `membership_required` gate. Copy tone/value props are a condensed
 * reuse of `sections/builders/builders-section.component.ts`; the CTA routes
 * to the landing-page waitlist anchor (`/` `#waitlist`), same as
 * `ProfileDetailsComponent`'s non-member CTA.
 */
@Component({
  selector: 'ptah-builders-pitch',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, LucideAngularModule],
  template: `
    <div
      class="max-w-2xl mx-auto bg-base-200/80 backdrop-blur-xl border border-secondary/20 rounded-2xl p-8 sm:p-10 text-center"
    >
      <span
        class="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-secondary/10 border border-secondary/20 mb-5"
      >
        <lucide-angular
          [img]="SparklesIcon"
          class="w-7 h-7 text-secondary"
          aria-hidden="true"
        />
      </span>

      <p
        class="font-mono text-xs uppercase tracking-[0.2em] text-secondary/80 mb-3"
      >
        Ptah Builders — Founding Waitlist
      </p>
      <h1 class="text-2xl sm:text-3xl font-bold tracking-tight leading-snug">
        The Members' Area Is a Builders Perk
      </h1>
      <p class="mt-4 text-neutral-content leading-relaxed">
        Ptah the app is free and open source. This area — live build sessions,
        the private community, and the founding cohort's course &amp; artifacts
        — is reserved for Ptah Builders members. Join the founding waitlist and
        we'll email your invite the moment membership opens.
      </p>

      <ul class="mt-6 grid sm:grid-cols-2 gap-3 text-left" role="list">
        @for (vp of valueProps; track vp.title) {
          <li
            class="flex items-start gap-2.5 text-sm bg-base-300/40 border border-secondary/10 rounded-xl px-4 py-3"
          >
            <lucide-angular
              [img]="vp.icon"
              class="w-4 h-4 text-secondary mt-0.5 shrink-0"
              aria-hidden="true"
            />
            {{ vp.title }}
          </li>
        }
      </ul>

      <div
        class="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3"
      >
        <a
          routerLink="/"
          fragment="waitlist"
          class="btn btn-secondary"
          aria-label="Join the Ptah Builders waitlist"
        >
          <lucide-angular [img]="ZapIcon" class="w-4 h-4" aria-hidden="true" />
          Join the Waitlist
        </a>
        <a
          routerLink="/"
          fragment="builders"
          class="btn btn-ghost"
          aria-label="See full Ptah Builders membership details"
        >
          <lucide-angular
            [img]="CheckIcon"
            class="w-4 h-4"
            aria-hidden="true"
          />
          See membership details
        </a>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class BuildersPitchComponent {
  protected readonly SparklesIcon = Sparkles;
  protected readonly ZapIcon = Zap;
  protected readonly CheckIcon = Check;

  protected readonly valueProps: readonly ValueProp[] = [
    { icon: GraduationCap, title: 'Live Training Sessions' },
    { icon: BookOpen, title: 'PRD-to-Production Curriculum' },
    { icon: Package, title: 'Member Skill Packs' },
    { icon: LifeBuoy, title: 'Priority Support' },
  ];
}

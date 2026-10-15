import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  HarnessBuilderRecordsService,
  type HarnessBuilderMode,
  type HarnessStackProfileRecord,
} from '../../services/harness-builder-records.service';

@Component({
  selector: 'ptah-builder-stack-profile-section',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (initialized() && mode() === 'new-project') {
      <section
        aria-labelledby="builder-stack-title"
        class="p-4 border-b border-surface-border"
      >
        <h3
          id="builder-stack-title"
          class="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-base-content-muted"
        >
          Stack profile
        </h3>
        <p class="text-[11px] text-base-content-muted">from project setup</p>
        @if (profile(); as stack) {
          <dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
            @if (stack.plugins.enabledBundled.length) {
              <dt>Plugins on</dt>
              <dd class="flex flex-wrap gap-1">
                @for (plugin of stack.plugins.enabledBundled; track plugin) {
                  <span class="badge badge-outline badge-sm"
                    >✓ {{ plugin }}</span
                  >
                }
              </dd>
            }
            @if (stack.plugins.missingExternal.length) {
              <dt>Not installed</dt>
              <dd class="flex flex-wrap gap-1">
                @for (
                  plugin of stack.plugins.missingExternal;
                  track plugin.marketplace + plugin.plugin
                ) {
                  <span
                    class="badge badge-outline badge-sm border-warning/55"
                    [title]="plugin.marketplace + ': ' + plugin.plugin"
                    >⚠ {{ plugin.marketplace }}: {{ plugin.plugin }}</span
                  >
                }
              </dd>
            }
            <dt>Skills</dt>
            <dd class="flex flex-wrap gap-1">
              <span>{{
                stack.plugins.availableSkillIds.length
                  ? stack.plugins.availableSkillIds.length + ' available'
                  : 'None available'
              }}</span>
              @for (
                skill of stack.plugins.availableSkillIds.slice(
                  0,
                  showAllSkills() ? undefined : 3
                );
                track skill
              ) {
                <span class="badge badge-outline badge-sm">{{ skill }}</span>
              }
              @if (
                !showAllSkills() && stack.plugins.availableSkillIds.length > 3
              ) {
                <button
                  type="button"
                  class="btn btn-ghost btn-xs min-h-6"
                  (click)="showAllSkills.set(true)"
                >
                  +{{ stack.plugins.availableSkillIds.length - 3 }} more
                </button>
              }
            </dd>
            @if (stack.toolchain; as tool) {
              <dt>Toolchain</dt>
              <dd>
                {{
                  tool.installed
                    ? tool.satisfiesMin
                      ? 'Meets minimum'
                      : 'Older than minimum'
                    : 'Not installed'
                }}
                · <span class="font-mono">{{ tool.command }}</span> ·
                {{ tool.installHint }}
              </dd>
            }
          </dl>
        } @else {
          <p
            role="status"
            class="mt-2 rounded-lg border border-surface-border bg-surface-2 p-3 text-xs"
          >
            Setup details are not available for this session. The agent still
            has them.
          </p>
        }
      </section>
    }
  `,
})
export class BuilderStackProfileSectionComponent {
  readonly initialized = input(false);
  readonly mode = input<HarnessBuilderMode>('configure-harness');
  readonly tabId = input.required<string>();
  readonly workspaceRoot = input('');
  private readonly records = inject(HarnessBuilderRecordsService);
  protected readonly profile = signal<HarnessStackProfileRecord | null>(null);
  protected readonly showAllSkills = signal(false);
  private initializedKey = '';
  constructor() {
    effect(() => {
      const root = this.workspaceRoot();
      const tab = this.tabId();
      if (
        !this.initialized() ||
        !root ||
        !tab ||
        root + ':' + tab === this.initializedKey
      )
        return;
      this.initializedKey = root + ':' + tab;
      this.profile.set(this.records.readStackProfile(root, tab));
    });
  }
}

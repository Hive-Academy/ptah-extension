import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { AppStateManager, LoggingService } from '@ptah-extension/core';
import { HarnessBuilderRecordsService } from '../../services/harness-builder-records.service';
import { HarnessProposalHydrationService } from '../../services/harness-proposal-hydration.service';
import {
  HarnessHelperService,
  type HarnessHelperKind,
  type HarnessHelperAddition,
} from '../../services/harness-helper.service';
import {
  HELPERS,
  commitBuilderUpdates,
  fullConfig,
  helperResultText as formatHelperResult,
} from './builder-sidebar-helpers';

@Component({
  selector: 'ptah-builder-ai-helpers-section',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (initialized()) {
      <section
        aria-labelledby="builder-helpers-title"
        class="p-4 border-b border-surface-border"
      >
        <h3
          id="builder-helpers-title"
          class="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-base-content-muted"
        >
          AI helpers
        </h3>
        <p class="text-[11px] text-base-content-muted">
          One-off helpers. Results go into the preview only when you choose Add
          to preview.
        </p>
        <div role="status" class="sr-only">{{ helperAnnouncement() }}</div>
        @for (row of helperRows; track row.kind; let i = $index) {
          @if (i === 5) {
            <button
              type="button"
              class="btn btn-ghost btn-sm mt-3"
              [attr.aria-expanded]="showMoreHelpers()"
              aria-controls="builder-more-helpers"
              (click)="showMoreHelpers.set(!showMoreHelpers())"
            >
              More helpers
            </button>
          }
          @if (i < 5 || showMoreHelpers()) {
            <div
              [id]="i === 5 ? 'builder-more-helpers' : null"
              class="mt-2 rounded-lg border border-surface-border bg-surface-2"
              [attr.aria-busy]="helper.busy() === row.kind ? true : null"
            >
              <button
                type="button"
                class="min-h-11 w-full px-3 py-1.5 flex items-center gap-2.5 text-left rounded-lg hover:bg-base-content/5"
                [attr.aria-expanded]="
                  helper.result()?.kind === row.kind ||
                  helper.error()?.kind === row.kind ||
                  activeInput() === row.kind
                "
                [attr.aria-disabled]="helperDisabled(row.kind) ? true : null"
                [attr.aria-describedby]="
                  helperDisabled(row.kind) ? 'helper-reason-' + row.kind : null
                "
                (click)="openHelper(row.kind)"
              >
                <span class="flex-1"
                  ><span class="block text-[13px] font-medium">{{
                    row.title
                  }}</span
                  ><span class="block text-[11px] text-base-content-muted">{{
                    row.description
                  }}</span></span
                >
                @if (helper.busy() === row.kind) {
                  <span class="text-[11px] text-state-run">Working...</span>
                } @else if (helper.result()?.kind === row.kind) {
                  <span class="text-[11px] text-state-done">Ready</span>
                }
              </button>
              @if (helperDisabled(row.kind)) {
                <p
                  [id]="'helper-reason-' + row.kind"
                  class="px-3 pb-2 text-[11px]"
                >
                  {{ helperReason(row.kind) }}
                </p>
              }
              @if (activeInput() === row.kind) {
                <div class="px-3 pb-3">
                  <label for="builder-intent" class="text-xs"
                    >Describe the product or paste a PRD</label
                  ><textarea
                    #intentInput
                    id="builder-intent"
                    class="textarea textarea-bordered w-full border-base-content/50"
                    [value]="intentText()"
                    (input)="intentText.set(intentInput.value)"
                  ></textarea
                  ><button
                    type="button"
                    class="btn btn-outline btn-sm border-base-content/50"
                    (click)="runHelper(row.kind)"
                  >
                    Analyze</button
                  ><button
                    type="button"
                    class="btn btn-ghost btn-sm"
                    (click)="activeInput.set(null)"
                  >
                    Cancel
                  </button>
                </div>
              }
              @if (helper.result(); as helperResult) {
                @if (helperResult.kind === row.kind) {
                  <div class="px-3 pb-3 text-xs">
                    @if (
                      row.kind === 'generate-document' ||
                      row.kind === 'generate-claude-md' ||
                      row.kind === 'generate-prompt'
                    ) {
                      <div
                        tabindex="0"
                        [attr.aria-label]="
                          row.kind === 'generate-document'
                            ? 'Generated document'
                            : row.title
                        "
                        class="max-h-40 overflow-auto rounded-md border border-surface-border bg-base-100 p-2 font-mono text-[11px] whitespace-pre-wrap break-words"
                        [textContent]="helperResultText()"
                      ></div>
                      <button
                        type="button"
                        class="btn btn-ghost btn-xs min-h-6"
                        (click)="copyHelperText()"
                      >
                        Copy
                      </button>
                    } @else {
                      <p role="status">{{ helperResultText() }}</p>
                    }
                    @if (
                      row.kind !== 'generate-document' &&
                      row.kind !== 'generate-claude-md'
                    ) {
                      <button
                        type="button"
                        class="btn btn-outline btn-xs border-base-content/50"
                        (click)="addHelperResult()"
                      >
                        {{
                          row.kind === 'generate-prompt'
                            ? 'Use as prompt'
                            : 'Add to preview'
                        }}
                      </button>
                    }
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs"
                      (click)="helper.dismiss()"
                    >
                      Dismiss
                    </button>
                  </div>
                }
              }
              @if (helper.error(); as helperError) {
                @if (helperError.kind === row.kind) {
                  <div role="alert" class="px-3 pb-3 text-xs">
                    <p>{{ row.title }} failed. {{ helperError.message }}</p>
                    <button
                      type="button"
                      class="btn btn-outline btn-xs border-base-content/50"
                      (click)="runHelper(row.kind)"
                    >
                      Try again</button
                    ><button
                      type="button"
                      class="btn btn-ghost btn-xs"
                      (click)="helper.dismiss()"
                    >
                      Dismiss
                    </button>
                  </div>
                }
              }
            </div>
          }
        }
      </section>
    }
  `,
})
export class BuilderAiHelpersSectionComponent {
  readonly initialized = input(false);
  readonly tabId = input.required<string>();
  readonly workspaceRoot = input('');
  readonly document = input<string | null>(null);
  readonly documentAdded = output<string>();
  protected readonly hydration = inject(HarnessProposalHydrationService);
  protected readonly helper = inject(HarnessHelperService);
  private readonly records = inject(HarnessBuilderRecordsService);
  private readonly appState = inject(AppStateManager);
  private readonly logger = inject(LoggingService);
  protected readonly helperRows = HELPERS;
  protected readonly showMoreHelpers = signal(false);
  protected readonly activeInput = signal<HarnessHelperKind | null>(null);
  protected readonly intentText = signal('');
  protected readonly helperAnnouncement = signal('');
  protected readonly preview = computed(() => this.hydration.config());
  protected readonly hasPreview = computed(
    () => Object.keys(this.preview()).length > 0 || !!this.document(),
  );

  protected helperReason(kind: HarnessHelperKind): string {
    if (this.helper.busy()) return 'Another helper is working.';
    if (kind === 'analyze-intent' || kind === 'discover-mcp') return '';
    if (kind === 'generate-document' || kind === 'generate-claude-md')
      return 'Add something to the preview first.';
    return 'Needs a persona. Describe who this is for in the chat first.';
  }
  protected helperDisabled(kind: HarnessHelperKind): boolean {
    return (
      !!this.helper.busy() ||
      (kind !== 'analyze-intent' &&
        kind !== 'discover-mcp' &&
        (kind === 'generate-document' || kind === 'generate-claude-md'
          ? !this.hasPreview()
          : !this.preview().persona))
    );
  }
  protected openHelper(kind: HarnessHelperKind): void {
    if (this.helperDisabled(kind)) return;
    if (kind === 'analyze-intent') {
      this.activeInput.set(kind);
      return;
    }
    void this.runHelper(kind);
  }
  protected async runHelper(kind: HarnessHelperKind): Promise<void> {
    if (this.helper.busy()) return;
    const config = this.preview();
    const persona = config.persona;
    switch (kind) {
      case 'suggest-config':
        if (persona)
          await this.helper.suggestConfig({
            personaDescription: persona.description || persona.label,
            goals: persona.goals,
          });
        break;
      case 'analyze-intent':
        if (this.intentText().trim()) {
          this.activeInput.set(null);
          await this.helper.analyzeIntent({ input: this.intentText().trim() });
        }
        break;
      case 'design-agents':
        if (persona)
          await this.helper.designAgents({
            persona,
            existingAgents: Object.keys(config.agents?.enabledAgents ?? {}),
          });
        break;
      case 'generate-skills':
        if (persona)
          await this.helper.generateSkills({
            persona,
            existingSkills: config.skills?.selectedSkills ?? [],
            harnessSubagents: config.agents?.harnessSubagents,
          });
        break;
      case 'generate-document':
        await this.helper.generateDocument({
          config: fullConfig(this.preview(), this.workspaceRoot()),
        });
        break;
      case 'discover-mcp':
        await this.helper.discoverMcp();
        break;
      case 'generate-prompt':
        if (persona)
          await this.helper.generatePrompt({
            persona,
            enabledAgents: Object.keys(config.agents?.enabledAgents ?? {}),
            selectedSkills: config.skills?.selectedSkills ?? [],
          });
        break;
      case 'generate-claude-md': {
        const config = fullConfig(this.preview(), this.workspaceRoot());
        await this.helper.generateClaudeMd({
          config: {
            name: config.name,
            persona: config.persona,
            agents: config.agents,
            skills: config.skills,
            prompt: config.prompt,
            mcp: config.mcp,
          },
        });
        break;
      }
    }
  }
  protected helperResultText(): string {
    return formatHelperResult(this.helper.result());
  }
  protected async copyHelperText(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.helperResultText());
    } catch (error) {
      this.logger.error(
        'HarnessBuilderSidebarComponent',
        'Could not copy helper result',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }
  protected async addHelperResult(): Promise<void> {
    const kind = this.helper.result()?.kind;
    const ok = await this.helper.addToPreview(
      this.preview(),
      (addition: HarnessHelperAddition) => {
        commitBuilderUpdates(
          this.records,
          this.hydration,
          this.workspaceRoot(),
          this.tabId(),
          this.preview(),
          addition.updates,
        );
        if (addition.document) this.documentAdded.emit(addition.document);
      },
    );
    if (ok) {
      this.helperAnnouncement.set('Added to preview');
      if (kind === 'generate-prompt')
        this.appState.requestComposerPrefill(
          'I used the generated prompt in the preview. Please continue from it.',
          this.tabId(),
        );
    }
  }
}

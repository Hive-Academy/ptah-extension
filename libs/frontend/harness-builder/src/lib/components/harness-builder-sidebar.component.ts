import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
  ElementRef,
} from '@angular/core';
import {
  SessionStatsSummaryComponent,
  type LiveModelStats,
} from '@ptah-extension/chat-ui';
import { AppStateManager, LoggingService } from '@ptah-extension/core';
import { HarnessHealthStore } from '@ptah-extension/marketplace/services';
import type {
  HarnessConfig,
  HarnessPreset,
  HarnessApplyResponse,
  SessionStatsEntry,
} from '@ptah-extension/shared';
import { HarnessConfigPreviewComponent } from './harness-config-preview.component';
import {
  HarnessBuilderRecordsService,
  HARNESS_CHOICE_FIELDS,
  canonicalHarnessRoot,
  type HarnessStackProfileRecord,
  type HarnessUserSnapshot,
  type HarnessBuilderMode,
} from '../services/harness-builder-records.service';
import {
  HarnessProposalHydrationService,
  mergeBuilderUpdates,
} from '../services/harness-proposal-hydration.service';
import {
  HarnessHelperService,
  type HarnessHelperKind,
  type HarnessHelperAddition,
} from '../services/harness-helper.service';
import { HarnessRpcService } from '../services/harness-rpc.service';

const HELPERS: readonly {
  kind: HarnessHelperKind;
  title: string;
  description: string;
}[] = [
  {
    kind: 'suggest-config',
    title: 'Suggest from persona',
    description: 'Agents, skills, MCP servers and a prompt',
  },
  {
    kind: 'analyze-intent',
    title: 'Analyze intent',
    description: 'Turn a description or PRD into a full blueprint',
  },
  {
    kind: 'design-agents',
    title: 'Design subagents',
    description: 'A custom subagent fleet for the persona',
  },
  {
    kind: 'generate-skills',
    title: 'Generate skill specs',
    description: 'Specialised skills for the persona',
  },
  {
    kind: 'generate-document',
    title: 'Generate document',
    description: 'A requirements document from the preview',
  },
  {
    kind: 'discover-mcp',
    title: 'MCP suggestions',
    description: 'Find MCP servers for this workspace',
  },
  {
    kind: 'generate-prompt',
    title: 'Generate prompt',
    description: 'Draft a system prompt',
  },
  {
    kind: 'generate-claude-md',
    title: 'CLAUDE.md preview',
    description: 'Preview a project instruction file',
  },
];

@Component({
  selector: 'ptah-harness-builder-sidebar',
  standalone: true,
  imports: [HarnessConfigPreviewComponent, SessionStatsSummaryComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-h-0 h-full' },
  template: `
    <aside
      id="builder-sidebar"
      aria-label="Configuration"
      [class]="
        sheet()
          ? 'flex flex-col w-full shrink-0 min-h-0 h-full bg-surface-1'
          : 'flex flex-col w-[336px] shrink-0 min-h-0 h-full bg-surface-1'
      "
    >
      <div
        data-testid="sidebar-strip"
        class="shrink-0 px-4 py-2.5 min-h-12 border-b border-surface-border flex items-center justify-between"
      >
        <h2 class="text-xs font-semibold">Configuration</h2>
        <span class="text-[11px] text-base-content-muted">{{ summary() }}</span>
      </div>
      <div
        data-testid="sidebar-scroll-body"
        class="flex-1 min-h-0 overflow-y-auto"
      >
        @if (!initialized()) {
          <section
            aria-labelledby="builder-setup-title"
            class="p-4 border-b border-surface-border"
          >
            <h3
              id="builder-setup-title"
              class="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-base-content-muted"
            >
              Builder setup
            </h3>
            @if (initError()) {
              <div
                role="alert"
                class="mt-2 rounded-lg border border-state-err/55 bg-error/10 px-3 py-2.5 text-[13px]"
              >
                <p class="font-semibold">Could not load workspace details</p>
                <p>
                  Apply and the AI helpers need them. You can keep chatting
                  meanwhile.
                </p>
                <button
                  type="button"
                  class="btn btn-outline btn-sm mt-2 border-base-content/50"
                  (click)="retrySetup.emit()"
                >
                  Retry
                </button>
              </div>
            } @else {
              <div role="status" aria-busy="true" class="mt-2 space-y-2">
                <div class="skeleton h-3 w-full"></div>
                <div class="skeleton h-3 w-3/4"></div>
                <p class="text-xs text-base-content-muted">
                  Initializing AI Team Builder...
                </p>
              </div>
            }
          </section>
        } @else {
          @if (hasPreview() || result() || applyError()) {
            <section
              aria-labelledby="builder-apply-title"
              class="p-4 border-b border-surface-border"
            >
              <h3
                id="builder-apply-title"
                tabindex="-1"
                class="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-base-content-muted"
              >
                Apply
              </h3>
              @if (applyError()) {
                <div
                  role="alert"
                  class="mt-2 rounded-lg border border-state-err/55 bg-error/10 px-3 py-2.5 text-[13px]"
                >
                  <p class="font-semibold">Apply failed</p>
                  <p>Nothing was written. Your preview is still here.</p>
                  <button
                    type="button"
                    class="btn btn-outline btn-xs mt-2 border-base-content/50"
                    (click)="dismissError()"
                  >
                    Dismiss
                  </button>
                </div>
              }
              @if (result(); as applied) {
                <div
                  role="status"
                  class="mt-2 rounded-lg border border-state-done/45 bg-success/10 px-3 py-2.5 text-[13px]"
                >
                  <h4 #resultHeading tabindex="-1" class="font-semibold">
                    Applied to {{ workspaceName() }}
                  </h4>
                  <p>{{ applied.appliedPaths.length }} files written.</p>
                </div>
                <ul
                  aria-label="Files written"
                  class="mt-2 rounded-lg border border-surface-border bg-surface-2"
                >
                  @for (path of visiblePaths(); track path) {
                    <li
                      class="px-2.5 py-1.5 font-mono text-[11px] break-all border-b border-surface-border last:border-0"
                    >
                      {{ displayPath(path) }}
                    </li>
                  }
                </ul>
                @if (!showAllPaths() && applied.appliedPaths.length > 5) {
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs min-h-6 mt-1"
                    (click)="showAllPaths.set(true)"
                  >
                    Show all {{ applied.appliedPaths.length }}
                  </button>
                }
                <button
                  type="button"
                  class="btn btn-ghost btn-xs min-h-6"
                  aria-label="Copy the list of written files"
                  (click)="copyPaths()"
                >
                  Copy list
                </button>
                @if (applied.warnings.length) {
                  <div
                    role="status"
                    class="mt-2 rounded-lg border border-state-need/45 bg-warning/12 px-3 py-2.5 text-[13px]"
                  >
                    <h4 class="font-semibold">
                      {{ applied.warnings.length }} warnings
                    </h4>
                    <ul class="list-disc pl-4">
                      @for (warning of applied.warnings; track warning) {
                        <li>{{ warning }}</li>
                      }
                    </ul>
                  </div>
                }
                @if (health.loading()) {
                  <p role="status" class="mt-2 text-xs">
                    Checking harness health...
                  </p>
                } @else if (health.summary().level !== 'unknown') {
                  <p role="status" class="mt-2 text-xs">
                    Health: {{ health.summary().label }}
                    @if (health.summary().level !== 'ok') {
                      <button
                        type="button"
                        class="btn btn-ghost btn-xs min-h-6"
                        (click)="openDashboard.emit()"
                      >
                        Open in Dashboard
                      </button>
                    }
                  </p>
                }
                <button
                  type="button"
                  class="btn btn-ghost btn-xs min-h-6 mt-2"
                  (click)="dismissResult()"
                >
                  Dismiss result
                </button>
                @if (previewChanged()) {
                  <div
                    role="status"
                    class="mt-2 rounded-lg border border-surface-border bg-surface-2 px-3 py-2.5 text-[13px]"
                  >
                    Preview changed since the last apply. Apply again to update
                    the workspace.
                  </div>
                  <button
                    type="button"
                    class="btn btn-primary btn-sm w-full mt-2"
                    [disabled]="agentBusy() || applying()"
                    (click)="apply()"
                  >
                    {{ applying() ? 'Applying...' : 'Apply to Workspace' }}
                  </button>
                }
              } @else {
                @if (
                  hydration.isConfigComplete() && !agentBusy() && !applyError()
                ) {
                  <div
                    class="mt-2 rounded-lg border border-state-done/45 bg-success/10 px-3 py-2.5 text-[13px]"
                  >
                    <p class="font-semibold">Configuration looks ready</p>
                    <p>Review the preview, then apply it to the workspace.</p>
                  </div>
                } @else if (agentBusy()) {
                  <div
                    class="mt-2 rounded-lg border border-surface-border bg-surface-2 px-3 py-2.5 text-[13px]"
                  >
                    <p class="font-semibold">Waiting for the agent</p>
                    <p id="apply-wait-reason">
                      Apply is available when the agent finishes its turn.
                    </p>
                  </div>
                } @else if (!applyError()) {
                  <p class="mt-2 text-xs">
                    The preview is partial. You can apply what is here now, or
                    keep chatting to finish it.
                  </p>
                }
                <button
                  #applyButton
                  type="button"
                  class="mt-2"
                  [class]="applyButtonClass()"
                  [attr.aria-disabled]="agentBusy() || applying() ? true : null"
                  [attr.aria-describedby]="
                    agentBusy() ? 'apply-wait-reason' : null
                  "
                  [attr.aria-busy]="applying() ? true : null"
                  (click)="apply()"
                >
                  {{
                    applying()
                      ? 'Applying...'
                      : applyError()
                        ? 'Try again'
                        : 'Apply to Workspace'
                  }}
                </button>
                <p class="mt-1 text-[11px] text-base-content-muted">
                  Writes into <b>{{ workspaceName() }}</b>
                </p>
              }
            </section>
          }
          @if (mode() === 'new-project') {
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
              <p class="text-[11px] text-base-content-muted">
                from project setup
              </p>
              @if (profile(); as stack) {
                <dl
                  class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs"
                >
                  @if (stack.plugins.enabledBundled.length) {
                    <dt>Plugins on</dt>
                    <dd class="flex flex-wrap gap-1">
                      @for (
                        plugin of stack.plugins.enabledBundled;
                        track plugin
                      ) {
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
                      <span class="badge badge-outline badge-sm">{{
                        skill
                      }}</span>
                    }
                    @if (
                      !showAllSkills() &&
                      stack.plugins.availableSkillIds.length > 3
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
                  Setup details are not available for this session. The agent
                  still has them.
                </p>
              }
            </section>
          }
        }
        <section
          aria-labelledby="builder-preview-title"
          class="p-4 border-b border-surface-border"
        >
          <h3
            id="builder-preview-title"
            class="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-base-content-muted"
          >
            Preview
          </h3>
          <p class="text-[11px] text-base-content-muted">{{ summary() }}</p>
          <div class="mt-2">
            <ptah-harness-config-preview
              [config]="preview()"
              [document]="document()"
              [mode]="mode() === 'new-project' ? 'new-project' : 'configure'"
              [status]="previewStatus()"
              (retry)="hydration.retry()"
              (proposeAgain)="proposeAgain()"
            />
          </div>
        </section>
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
              One-off helpers. Results go into the preview only when you choose
              Add to preview.
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
                    [attr.aria-disabled]="
                      helperDisabled(row.kind) ? true : null
                    "
                    [attr.aria-describedby]="
                      helperDisabled(row.kind)
                        ? 'helper-reason-' + row.kind
                        : null
                    "
                    (click)="openHelper(row.kind)"
                  >
                    <span class="flex-1"
                      ><span class="block text-[13px] font-medium">{{
                        row.title
                      }}</span
                      ><span
                        class="block text-[11px] text-base-content-muted"
                        >{{ row.description }}</span
                      ></span
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
          <section
            aria-labelledby="builder-presets-title"
            class="p-4 border-b border-surface-border"
          >
            <h3
              id="builder-presets-title"
              class="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-base-content-muted"
            >
              Presets
            </h3>
            <p class="text-[11px] text-base-content-muted">
              {{ presets().length }} saved
            </p>
            @if (presets().length) {
              <label for="builder-preset" class="block mt-2 text-xs"
                >Start from a preset</label
              >
              <select
                #presetSelect
                id="builder-preset"
                class="select select-sm select-bordered w-full border-base-content/50"
                [value]="selectedPresetId()"
                (change)="selectedPresetId.set(presetSelect.value)"
              >
                <option value="">Choose a preset...</option>
                @for (preset of presets(); track preset.id) {
                  <option [value]="preset.id">{{ preset.name }}</option>
                }
              </select>
              <button
                type="button"
                class="btn btn-outline btn-sm mt-2 border-base-content/50"
                [disabled]="!selectedPresetId()"
                (click)="loadPreset()"
              >
                Load
              </button>
              <p class="text-[11px] text-base-content-muted">
                Loads the preset into the preview. Existing preview items are
                kept where they do not conflict.
              </p>
            } @else {
              <p class="mt-2 text-xs">
                No saved presets yet. Apply or save one to reuse it.
              </p>
            }
            @if (presetNotice()) {
              <p role="status" class="mt-2 text-xs">{{ presetNotice() }}</p>
            }
            @if (presetLoadError()) {
              <p role="alert" class="mt-2 text-xs">
                Could not load presets. Try again.
              </p>
              <button
                type="button"
                class="btn btn-outline btn-xs border-base-content/50"
                (click)="loadPresets()"
              >
                Retry
              </button>
            }
            <button
              type="button"
              class="btn btn-ghost btn-sm mt-2"
              [attr.aria-expanded]="saveFormOpen()"
              aria-controls="save-form"
              (click)="saveFormOpen.set(!saveFormOpen())"
            >
              Save as preset
            </button>
            @if (saveFormOpen()) {
              <div id="save-form" class="mt-2 space-y-2">
                <p class="text-xs">
                  Saves the current preview as a reusable preset. Nothing is
                  written to the workspace until you apply.
                </p>
                <label for="preset-name" class="block text-xs"
                  >Name (required)</label
                ><input
                  #nameInput
                  id="preset-name"
                  class="input input-sm input-bordered w-full border-base-content/50"
                  [value]="presetName()"
                  [attr.aria-invalid]="nameInvalid() ? true : null"
                  [attr.aria-describedby]="
                    nameInvalid() ? 'preset-name-error' : null
                  "
                  (input)="presetName.set(nameInput.value)"
                />
                @if (nameInvalid()) {
                  <p id="preset-name-error" role="alert" class="text-xs">
                    Enter a name for the preset.
                  </p>
                }
                <label for="preset-description" class="block text-xs"
                  >Description (optional)</label
                ><textarea
                  #descriptionInput
                  id="preset-description"
                  class="textarea textarea-bordered w-full border-base-content/50"
                  [value]="presetDescription()"
                  (input)="presetDescription.set(descriptionInput.value)"
                ></textarea
                ><button
                  type="button"
                  class="btn btn-outline btn-sm border-base-content/50"
                  [attr.aria-disabled]="
                    !hasPreview() || savingPreset() ? true : null
                  "
                  (click)="savePreset()"
                >
                  Save preset
                </button>
              </div>
            }
            @if (presetError()) {
              <p role="alert" class="mt-2 text-xs">
                Could not save the preset. Nothing was saved.
              </p>
            }
          </section>
          <section
            aria-labelledby="builder-session-title"
            class="p-4 border-b border-surface-border"
          >
            <button
              type="button"
              class="w-full text-left flex items-center justify-between"
              [attr.aria-expanded]="sessionOpen()"
              aria-controls="builder-session-content"
              (click)="sessionOpen.set(!sessionOpen())"
            >
              <span
                id="builder-session-title"
                class="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-base-content-muted"
                >Session</span
              ><span class="text-[11px] text-base-content-muted">{{
                sessionSummary()
              }}</span>
            </button>
            @if (sessionOpen()) {
              <div id="builder-session-content" class="mt-2">
                <ptah-session-stats-summary
                  [snapshot]="statsSnapshot()"
                  [liveModelStats]="liveModelStats()"
                />
              </div>
            }
          </section>
        }
      </div>
    </aside>
  `,
})
export class HarnessBuilderSidebarComponent {
  readonly tabId = input.required<string>();
  readonly sheet = input(false);
  readonly workspaceRoot = input('');
  readonly mode = input<HarnessBuilderMode>('configure-harness');
  readonly initialized = input(false);
  readonly initError = input(false);
  readonly agentBusy = input(false);
  readonly statsSnapshot = input<SessionStatsEntry | null>(null);
  readonly liveModelStats = input<LiveModelStats | null>(null);
  readonly retrySetup = output<void>();
  readonly openDashboard = output<void>();

  protected readonly hydration = inject(HarnessProposalHydrationService);
  protected readonly helper = inject(HarnessHelperService);
  protected readonly health = inject(HarnessHealthStore);
  private readonly records = inject(HarnessBuilderRecordsService);
  private readonly rpc = inject(HarnessRpcService);
  private readonly appState = inject(AppStateManager);
  private readonly logger = inject(LoggingService);
  private readonly resultHeading =
    viewChild<ElementRef<HTMLElement>>('resultHeading');
  private readonly applyButton =
    viewChild<ElementRef<HTMLButtonElement>>('applyButton');
  protected readonly helperRows = HELPERS;
  protected readonly profile = signal<HarnessStackProfileRecord | null>(null);
  protected readonly result = signal<HarnessApplyResponse | null>(null);
  private readonly appliedPreview = signal<string | null>(null);
  protected readonly applyError = signal(false);
  protected readonly applying = signal(false);
  protected readonly showAllPaths = signal(false);
  protected readonly showAllSkills = signal(false);
  protected readonly showMoreHelpers = signal(false);
  protected readonly activeInput = signal<HarnessHelperKind | null>(null);
  protected readonly intentText = signal('');
  protected readonly document = signal<string | null>(null);
  protected readonly helperAnnouncement = signal('');
  protected readonly presets = signal<HarnessPreset[]>([]);
  protected readonly selectedPresetId = signal('');
  protected readonly presetNotice = signal('');
  protected readonly presetError = signal(false);
  protected readonly presetLoadError = signal(false);
  protected readonly saveFormOpen = signal(false);
  protected readonly presetName = signal('');
  protected readonly presetDescription = signal('');
  protected readonly nameInvalid = signal(false);
  protected readonly savingPreset = signal(false);
  protected readonly sessionOpen = signal(false);
  protected readonly preview = computed(() => this.hydration.config());
  protected readonly previewStatus = computed(() =>
    this.hydration.status() === 'loading'
      ? 'hydrating'
      : this.hydration.status() === 'error'
        ? 'failed'
        : this.hydration.status() === 'unavailable'
          ? 'unavailable'
          : 'ready',
  );
  protected readonly hasPreview = computed(
    () => Object.keys(this.preview()).length > 0 || !!this.document(),
  );
  protected readonly summary = computed(
    () =>
      `${Object.keys(this.preview().agents?.enabledAgents ?? {}).length} agents, ${this.preview().skills?.selectedSkills.length ?? 0} skills`,
  );
  protected readonly sessionSummary = computed(
    () =>
      `Context ${this.liveModelStats()?.contextPercent ?? '—'}% · ${this.statsSnapshot()?.totalCost === null || this.statsSnapshot()?.totalCost === undefined ? 'Cost unavailable' : '$' + this.statsSnapshot()?.totalCost?.toFixed(2)}`,
  );
  protected readonly visiblePaths = computed(
    () =>
      this.result()?.appliedPaths.slice(
        0,
        this.showAllPaths() ? undefined : 5,
      ) ?? [],
  );
  protected readonly previewChanged = computed(
    () =>
      this.result() !== null &&
      this.appliedPreview() !== JSON.stringify(this.preview()),
  );
  protected readonly applyButtonClass = computed(() =>
    (this.hydration.isConfigComplete() && !this.agentBusy()) ||
    this.applyError()
      ? 'btn btn-primary btn-sm w-full'
      : 'btn btn-outline btn-sm w-full border-base-content/50',
  );
  private initializedKey = '';

  constructor() {
    effect(() => {
      const root = this.workspaceRoot();
      const tab = this.tabId();
      if (
        !this.initialized() ||
        !root ||
        !tab ||
        `${root}:${tab}` === this.initializedKey
      )
        return;
      this.initializedKey = `${root}:${tab}`;
      this.profile.set(this.records.readStackProfile(root, tab));
      void this.loadPresets();
    });
  }

  protected workspaceName(): string {
    return (
      this.workspaceRoot().split(/[\\/]/).filter(Boolean).at(-1) ?? 'workspace'
    );
  }
  protected displayPath(path: string): string {
    const root = this.workspaceRoot();
    return root && path.startsWith(root + '/')
      ? path.slice(root.length + 1)
      : root && path.startsWith(root + '\\')
        ? path.slice(root.length + 1)
        : path;
  }
  protected dismissError(): void {
    this.applyError.set(false);
    queueMicrotask(() => this.applyButton()?.nativeElement.focus());
  }
  protected dismissResult(): void {
    this.result.set(null);
    this.appliedPreview.set(null);
    this.showAllPaths.set(false);
    queueMicrotask(() => this.applyButton()?.nativeElement.focus());
  }
  protected async copyPaths(): Promise<void> {
    const paths = this.result()?.appliedPaths;
    if (!paths) return;
    try {
      await navigator.clipboard.writeText(
        paths.map((path) => this.displayPath(path)).join('\n'),
      );
    } catch (error) {
      this.logger.error(
        'HarnessBuilderSidebarComponent',
        'Could not copy applied paths',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }
  protected async apply(): Promise<void> {
    if (
      !this.initialized() ||
      !this.hasPreview() ||
      this.agentBusy() ||
      this.applying() ||
      !this.workspaceRoot()
    )
      return;
    this.applying.set(true);
    this.applyError.set(false);
    this.result.set(null);
    this.appliedPreview.set(null);
    try {
      const result = await this.rpc.apply({
        config: this.fullConfig(),
        outputFormat: 'claude-md',
        workspaceRoot: this.workspaceRoot(),
      });
      this.result.set(result);
      this.showAllPaths.set(false);
      this.appliedPreview.set(JSON.stringify(this.preview()));
      queueMicrotask(() => this.resultHeading()?.nativeElement.focus());
      void this.health.refresh();
    } catch (error) {
      this.logger.error(
        'HarnessBuilderSidebarComponent',
        'Could not apply configuration',
        error instanceof Error ? error : new Error(String(error)),
      );
      this.applyError.set(true);
      queueMicrotask(() => this.applyButton()?.nativeElement.focus());
    } finally {
      this.applying.set(false);
    }
  }
  private fullConfig(): HarnessConfig {
    const c = this.preview();
    const now = new Date().toISOString();
    return {
      name: c.name?.trim() || this.workspaceName(),
      persona: c.persona ?? { label: '', description: '', goals: [] },
      agents: {
        enabledAgents: c.agents?.enabledAgents ?? {},
        harnessSubagents: c.agents?.harnessSubagents ?? [],
      },
      skills: {
        selectedSkills: c.skills?.selectedSkills ?? [],
        selectedSkillRefs: c.skills?.selectedSkillRefs ?? [],
        createdSkills: c.skills?.createdSkills ?? [],
      },
      prompt: {
        systemPrompt: c.prompt?.systemPrompt ?? '',
        enhancedSections: c.prompt?.enhancedSections ?? {},
      },
      mcp: {
        servers: c.mcp?.servers ?? [],
        enabledTools: c.mcp?.enabledTools ?? {},
      },
      claudeMd: {
        generateProjectClaudeMd: c.claudeMd?.generateProjectClaudeMd ?? true,
        customSections: c.claudeMd?.customSections ?? {},
        previewContent: c.claudeMd?.previewContent ?? '',
      },
      createdAt: c.createdAt ?? now,
      updatedAt: now,
    };
  }
  protected async loadPresets(): Promise<void> {
    try {
      this.presets.set((await this.rpc.loadPresets()).presets);
      this.presetLoadError.set(false);
    } catch (error) {
      this.logger.error(
        'HarnessBuilderSidebarComponent',
        'Could not load presets',
        error instanceof Error ? error : new Error(String(error)),
      );
      this.presetLoadError.set(true);
    }
  }
  private commit(updates: Partial<HarnessConfig>): void {
    const root = canonicalHarnessRoot(this.workspaceRoot());
    const tabId = this.tabId();
    if (!root || !tabId) throw new Error('Builder session is unavailable');
    const old = this.records.readSnapshot(root, tabId);
    const merged = mergeBuilderUpdates(this.preview(), updates);
    const at = new Date().toISOString();
    const fields: HarnessUserSnapshot['fields'] = { ...old?.fields };
    for (const field of HARNESS_CHOICE_FIELDS)
      if (updates[field] !== undefined)
        fields[field] = { source: 'user', chosenAt: at, updatedAt: at };
    const selected: Partial<HarnessConfig> = {};
    for (const field of HARNESS_CHOICE_FIELDS)
      if (fields[field] && merged[field] !== undefined)
        Object.assign(selected, { [field]: merged[field] });
    const snapshot: HarnessUserSnapshot = {
      version: 1,
      workspaceRoot: root,
      tabId,
      configUpdates: selected,
      fields,
      ...(old?.lastApplied ? { lastApplied: old.lastApplied } : {}),
    };
    if (!this.records.writeSnapshot(snapshot))
      throw new Error('Could not save preview choice');
    this.hydration.setSnapshot(snapshot);
  }
  protected loadPreset(): void {
    const preset = this.presets().find(
      (item) => item.id === this.selectedPresetId(),
    );
    if (!preset) return;
    try {
      this.commit(preset.config);
      this.appState.requestComposerPrefill(
        `I loaded the preset "${preset.name}" into the preview. Please use it as a starting point.`,
        this.tabId(),
      );
      this.presetNotice.set(
        `Loaded "${preset.name}". It is in the preview now. A note was added to your message box.`,
      );
      this.presetLoadError.set(false);
    } catch (error) {
      this.logger.error(
        'HarnessBuilderSidebarComponent',
        'Could not load preset',
        error instanceof Error ? error : new Error(String(error)),
      );
      this.presetLoadError.set(true);
    }
  }
  protected async savePreset(): Promise<void> {
    if (!this.hasPreview() || this.savingPreset()) return;
    const name = this.presetName().trim();
    this.nameInvalid.set(!name);
    if (!name) return;
    this.savingPreset.set(true);
    this.presetError.set(false);
    try {
      await this.rpc.savePreset({
        name,
        description: this.presetDescription().trim(),
        config: this.fullConfig(),
      });
      await this.loadPresets();
      this.presetNotice.set(
        `Saved "${name}". You can start from it in any workspace.`,
      );
      this.saveFormOpen.set(false);
    } catch (error) {
      this.logger.error(
        'HarnessBuilderSidebarComponent',
        'Could not save preset',
        error instanceof Error ? error : new Error(String(error)),
      );
      this.presetError.set(true);
    } finally {
      this.savingPreset.set(false);
    }
  }
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
        await this.helper.generateDocument({ config: this.fullConfig() });
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
        const config = this.fullConfig();
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
    const result = this.helper.result();
    if (!result) return '';
    switch (result.kind) {
      case 'generate-document':
        return result.value.document;
      case 'generate-claude-md':
        return result.value.content;
      case 'generate-prompt':
        return result.value.generatedPrompt;
      case 'design-agents':
        return result.value.subagents.map((item) => item.name).join(', ');
      case 'generate-skills':
        return result.value.skills.map((item) => item.name).join(', ');
      case 'discover-mcp':
        return result.value.servers.map((item) => item.name).join(', ');
      case 'analyze-intent':
        return result.value.persona.label;
      case 'suggest-config':
        return result.value.reasoning;
    }
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
        this.commit(addition.updates);
        if (addition.document) this.document.set(addition.document);
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
  protected proposeAgain(): void {
    this.appState.requestComposerPrefill(
      'Please propose the harness configuration again for this session.',
      this.tabId(),
    );
  }
}

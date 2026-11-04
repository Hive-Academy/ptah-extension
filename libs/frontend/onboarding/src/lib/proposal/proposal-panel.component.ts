import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { BuilderStackProfileSectionComponent } from '@ptah-extension/harness-builder';
import type { HarnessConfig } from '@ptah-extension/shared';
import {
  ProposalSectionComponent,
  type ProposalSectionItem,
} from './proposal-section.component';
import type { ChangeTag } from './proposal-flow.store';

const FIELDS = [
  ['name', 'Name'],
  ['persona', 'Persona'],
  ['agents', 'Agents'],
  ['skills', 'Skills'],
  ['prompt', 'Prompt'],
  ['mcp', 'MCP'],
  ['claudeMd', 'CLAUDE.md'],
] as const;
@Component({
  selector: 'ptah-proposal-panel',
  standalone: true,
  imports: [ProposalSectionComponent, BuilderStackProfileSectionComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="space-y-3" data-testid="proposal-panel">
    <section
      class="space-y-3 rounded-[16px] border border-base-300 bg-base-100 p-4"
      data-glass-surface="content"
      aria-labelledby="proposal-config-title"
    >
      <div class="flex flex-wrap items-center gap-2">
          <h2 id="proposal-config-title" class="mr-auto text-base font-semibold">
            Configuration proposal
          </h2>
          <span class="badge badge-outline badge-sm text-base-content">Revision {{ ordinal() }}</span>
        <span class="inline-flex items-center gap-1 rounded-md border border-base-300 bg-base-200 px-2 py-1 text-xs font-medium text-base-content" data-testid="config-completeness">
          <svg class="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="4" width="12" height="18" rx="2"/><path d="M8 7H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h9M12 4.5h4M12 14l2 2 4-4"/></svg>
          {{ complete() ? 'Config complete' : 'Config incomplete' }}
        </span>
      </div>
      @if (items().length) {
        <ptah-proposal-section title="Configuration" [items]="items()" />
      } @else {
        <p class="text-sm text-base-content-muted">
          The agent has not proposed a configuration yet.
        </p>
      }
    </section>
    @if (mode() === 'new-project' && tabId() && showIntakeFacts()) {
      <section
        class="rounded-[12px] border border-base-300 bg-base-200 p-3"
        data-glass-surface="tile"
        aria-labelledby="proposal-intake-title"
      >
        <h2 id="proposal-intake-title" class="text-sm font-semibold">
          From your intake
        </h2>
        <ptah-builder-stack-profile-section
          [initialized]="true"
          mode="new-project"
          [tabId]="tabId()"
          [workspaceRoot]="workspaceRoot()"
        />
      </section>
    }
    @if (document(); as content) {
      <section
        class="rounded-[12px] border border-base-300 bg-base-200 p-3"
        data-glass-surface="tile"
        aria-labelledby="proposal-document-title"
      >
        <div class="flex items-center justify-between gap-2">
          <h2 id="proposal-document-title" class="text-sm font-semibold">
            Generated document
          </h2>
          <button
            type="button"
            class="btn btn-ghost btn-xs"
            (click)="copyDocument.emit(content)"
          >
            Copy
          </button>
        </div>
        <pre
          tabindex="0"
          aria-label="Generated document"
          class="mt-3 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-base-300 bg-base-100 p-3 font-mono text-xs"
          >{{ content }}</pre>
      </section>
    }
  </div>`,
})
export class ProposalPanelComponent {
  readonly config = input<Partial<HarnessConfig>>({});
  readonly tags = input<ReadonlyMap<string, ChangeTag>>(new Map());
  readonly ordinal = input(0);
  readonly complete = input(false);
  readonly mode = input<'new-project' | 'configure-harness'>(
    'configure-harness',
  );
  readonly tabId = input('');
  readonly workspaceRoot = input('');
  readonly document = input<string | null>(null);
  readonly showIntakeFacts = input(false);
  readonly copyDocument = output<string>();
  readonly items = computed<ProposalSectionItem[]>(() =>
    FIELDS.filter(([key]) => this.config()[key] !== undefined).map(
      ([key, label]) => {
        const nestedChanged = [...this.tags().keys()].some((path) =>
          path.startsWith(`${key}.`),
        );
        return {
          key,
          label,
          value: this.config()[key],
          tag: this.tags().get(key) ?? (nestedChanged ? 'changed' : null),
          createdSkills:
            key === 'skills'
              ? (this.config().skills?.createdSkills?.map(
                  (skill) => skill.name,
                ) ?? [])
              : [],
        };
      },
    ),
  );
}

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
  template: `<div class="space-y-5" data-testid="proposal-panel">
    <section
      class="space-y-3 rounded-[22px] border border-base-300 p-5"
      data-glass-surface="content"
      aria-labelledby="proposal-config-title"
    >
      <div class="flex flex-wrap justify-between gap-2">
        <div>
          <h2 id="proposal-config-title" class="text-lg font-semibold">
            Configuration proposal
          </h2>
          <p class="text-sm text-base-content-muted">
            Revision {{ ordinal() }}
          </p>
        </div>
        <span class="badge badge-outline">{{
          complete() ? 'Complete' : 'In progress'
        }}</span>
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
        class="rounded-[22px] border border-base-300 p-5"
        data-glass-surface="content"
        aria-labelledby="proposal-intake-title"
      >
        <h2 id="proposal-intake-title" class="text-lg font-semibold">
          From your intake
        </h2>
        <p class="text-sm text-base-content-muted">
          Plugins and toolchain facts from project setup.
        </p>
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
        class="rounded-[22px] border border-base-300 p-5"
        data-glass-surface="content"
        aria-labelledby="proposal-document-title"
      >
        <div class="flex items-center justify-between gap-2">
          <h2 id="proposal-document-title" class="text-lg font-semibold">
            Generated document
            <span class="text-sm font-normal text-base-content-muted"
              >(helper output)</span
            >
          </h2>
          <button
            type="button"
            class="btn btn-sm"
            (click)="copyDocument.emit(content)"
          >
            Copy
          </button>
        </div>
        <pre
          class="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words text-sm"
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

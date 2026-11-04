import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import type { ChangeTag } from './proposal-flow.store';

@Component({
  selector: 'ptah-proposal-item',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<dl class="min-w-0 border-b border-base-300 py-3 first:pt-0 last:border-b-0 last:pb-0">
    <dt class="flex flex-wrap items-center gap-2 text-xs font-semibold text-base-content-muted">
      {{ label() }}
      @if (tag()) {
        <span
          class="badge badge-outline badge-sm bg-base-200"
          [class.text-state-done]="tag() === 'new'"
          [class.text-state-need]="tag() === 'changed'"
          >{{ tag() === 'new' ? 'New' : 'Changed' }}</span
        >
      }
    </dt>
    <dd class="mt-1 min-w-0 text-sm text-base-content">
      @if (chips().length) {
        <ul class="flex flex-wrap gap-1.5">
          @for (chip of chips(); track chip) {
            <li class="rounded-full border border-base-300 bg-base-100 px-2 py-0.5 text-xs">{{ chip }}</li>
          }
        </ul>
      } @else {
        <span class="whitespace-pre-wrap break-words">{{ display() }}</span>
      }
    @if (createdSkills().length) {
      <ul class="mt-2 space-y-1">
        @for (skill of createdSkills(); track skill) {
          <li class="text-sm">
            <span class="badge badge-outline badge-sm bg-base-200 text-state-done">Created</span>
            {{ skill }}
          </li>
        }
      </ul>
    }
    </dd>
  </dl>`,
})
export class ProposalItemComponent {
  readonly label = input.required<string>();
  readonly value = input.required<unknown>();
  readonly tag = input<ChangeTag | null>(null);
  readonly createdSkills = input<readonly string[]>([]);
  readonly chips = computed(() => {
    const value = this.value();
    if (!value || typeof value !== 'object') return [];
    if (this.label() === 'Agents' && 'enabledAgents' in value) {
      const agents = value.enabledAgents;
      return agents && typeof agents === 'object'
        ? Object.keys(agents).filter((name) => {
            const entry = (agents as Record<string, unknown>)[name];
            return entry && typeof entry === 'object' && 'enabled' in entry
              ? entry.enabled !== false
              : true;
          })
        : [];
    }
    if (this.label() === 'Skills' && 'selectedSkills' in value) {
      return Array.isArray(value.selectedSkills)
        ? value.selectedSkills.filter((skill): skill is string => typeof skill === 'string')
        : [];
    }
    if (this.label() === 'MCP' && 'servers' in value) {
      return Array.isArray(value.servers)
        ? value.servers.filter((server): server is { name: string } =>
            server && typeof server === 'object' && typeof server.name === 'string',
          ).map((server) => server.name)
        : [];
    }
    return [];
  });
  readonly display = computed(() => {
    const value = this.value();
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object') {
      if (this.label() === 'Persona' && 'description' in value && typeof value.description === 'string') return value.description;
      if (this.label() === 'Prompt' && 'systemPrompt' in value && typeof value.systemPrompt === 'string') return value.systemPrompt;
      if (this.label() === 'CLAUDE.md' && 'previewContent' in value && typeof value.previewContent === 'string') return value.previewContent;
    }
    return JSON.stringify(value, null, 2) ?? '—';
  });
}

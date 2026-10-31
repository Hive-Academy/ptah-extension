import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { formatAgentDuration, formatTokenCount } from '@ptah-extension/chat-ui';
import {
  formatDurationMs,
  formatUsdCost,
  messageTokenTotal,
} from '@ptah-extension/shared';
import type { MessageTokenUsage } from '@ptah-extension/shared';
import {
  summarizeTurnMetrics,
  type TurnContext,
  type TurnMessageMetrics,
} from '../../../utils/turn-facts.utils';

/** One `<dt>` / `<dd>` pair. */
interface ActivityItem {
  readonly label: string;
  readonly value: string;
}

/** One assistant message's own metrics (turns with N > 1). */
interface MessageSection {
  readonly id: string;
  /** `Message {n} of {N}`. */
  readonly ariaLabel: string;
  /** `Message {n}`. */
  readonly heading: string;
  readonly time: { readonly iso: string; readonly text: string } | null;
  readonly items: readonly ActivityItem[];
}

function tokensText(tokens: MessageTokenUsage): string {
  const cache = (tokens.cacheRead ?? 0) + (tokens.cacheCreation ?? 0);
  const base = `${formatTokenCount(tokens.input)} in · ${formatTokenCount(tokens.output)} out`;
  return cache > 0 ? `${base} · ${formatTokenCount(cache)} cache` : base;
}

/** `Tokens` or `Tokens · 2 of 3 messages` when not every message knows it. */
function coverageLabel(label: string, known: number, total: number): string {
  return known < total ? `${label} · ${known} of ${total} messages` : label;
}

function countItem(label: string, value: number): ActivityItem | null {
  return value > 0 ? { label, value: String(value) } : null;
}

function present(
  items: readonly (ActivityItem | null)[],
): readonly ActivityItem[] {
  return items.filter((item): item is ActivityItem => item !== null);
}

function messageDurationItem(
  label: string,
  message: TurnMessageMetrics,
): ActivityItem | null {
  return message.duration === undefined
    ? null
    : { label, value: formatDurationMs(message.duration) };
}

function messageTokensItem(
  tokens: MessageTokenUsage | undefined,
): ActivityItem | null {
  return tokens && messageTokenTotal(tokens) !== null
    ? { label: 'Tokens', value: tokensText(tokens) }
    : null;
}

function messageCostItem(cost: number | null | undefined): ActivityItem | null {
  const text = formatUsdCost(cost);
  return text === null ? null : { label: 'Cost', value: text };
}

/** `9:41 AM`, the user bubble's time format. */
function timeOf(
  timestamp: number | null,
): { readonly iso: string; readonly text: string } | null {
  if (timestamp === null) return null;
  const date = new Date(timestamp);
  return {
    iso: date.toISOString(),
    text: date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }),
  };
}

/**
 * A turn's activity panel (design-spec §3.11), opened by `Show activity`.
 *
 * Items, each only when known (never `0` or a placeholder): `Duration` (the
 * settled turn elapsed time of §3.9), then for a single-message turn that
 * message's `Message duration`, `Tokens`, `Cost`, `Tool calls` and
 * `Files changed`. A turn with more than one assistant message shows an
 * `All messages` summary (sums of the known values, with a
 * `· k of N messages` qualifier when some are unknown) and one labelled
 * section per message, so no per-message datum is lost.
 *
 * Renders nothing when every item is unknown. Presentational only.
 */
@Component({
  selector: 'ptah-turn-activity-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @if (sections().length === 0) {
      @if (summary().length > 0) {
        <dl
          [id]="panelId()"
          aria-label="Turn activity"
          class="mt-2 flex max-w-[600px] flex-wrap gap-x-5 gap-y-1.5 rounded-lg border border-surface-border bg-surface-1 px-3 py-2.5 text-xs"
          data-test="turn-activity-panel"
        >
          @for (item of summary(); track item.label) {
            <div class="flex flex-col-reverse">
              <dt class="text-[11px] text-base-content-muted">
                {{ item.label }}
              </dt>
              <dd class="font-medium tabular-nums">{{ item.value }}</dd>
            </div>
          }
        </dl>
      }
    } @else {
      <div
        [id]="panelId()"
        role="group"
        aria-label="Turn activity"
        class="mt-2 max-w-[600px] rounded-lg border border-surface-border bg-surface-1 px-3 py-2.5 text-xs"
        data-test="turn-activity-panel"
      >
        @if (summary().length > 0) {
          <h4
            [id]="panelId() + '-all'"
            class="mb-1.5 text-[11px] font-normal text-base-content-muted"
          >
            All messages
          </h4>
          <dl
            [attr.aria-labelledby]="panelId() + '-all'"
            class="flex flex-wrap gap-x-5 gap-y-1.5"
            data-test="turn-activity-summary"
          >
            @for (item of summary(); track item.label) {
              <div class="flex flex-col-reverse">
                <dt class="text-[11px] text-base-content-muted">
                  {{ item.label }}
                </dt>
                <dd class="font-medium tabular-nums">{{ item.value }}</dd>
              </div>
            }
          </dl>
        }
        @for (section of sections(); track section.id; let first = $first) {
          <section
            [attr.aria-label]="section.ariaLabel"
            [class]="
              'border-surface-border' +
              (!first || summary().length > 0 ? ' mt-2 border-t pt-2' : '')
            "
            data-test="turn-activity-message"
          >
            <h4
              class="mb-1.5 flex items-baseline gap-2 text-[11px] font-medium"
            >
              <span>{{ section.heading }}</span>
              @if (section.time; as time) {
                <time
                  class="font-normal tabular-nums text-base-content-muted"
                  [attr.datetime]="time.iso"
                  >{{ time.text }}</time
                >
              }
            </h4>
            <dl class="flex flex-wrap gap-x-5 gap-y-1.5">
              @for (item of section.items; track item.label) {
                <div class="flex flex-col-reverse">
                  <dt class="text-[11px] text-base-content-muted">
                    {{ item.label }}
                  </dt>
                  <dd class="font-medium tabular-nums">{{ item.value }}</dd>
                </div>
              }
            </dl>
          </section>
        }
      </div>
    }
  `,
})
export class TurnActivityPanelComponent {
  /** The turn (any of its assistant messages' context; facts are per turn). */
  readonly turn = input.required<TurnContext>();

  /** Panel id, the `aria-controls` target of the `Show activity` button. */
  readonly panelId = input.required<string>();

  /** Settled turn elapsed time (`E - S`, §3.9); `null` when not derivable. */
  private readonly turnDuration = computed(() => {
    const { startTs, settledEndTs } = this.turn();
    if (startTs === null || settledEndTs === null) return null;
    return formatAgentDuration(settledEndTs - startTs);
  });

  private readonly isMultiMessage = computed(
    () => this.turn().messages.length > 1,
  );

  /** The single-message items, or the `All messages` summary for N > 1. */
  protected readonly summary = computed<readonly ActivityItem[]>(() => {
    const turn = this.turn();
    const duration = this.turnDuration();
    const durationItem: ActivityItem | null =
      duration === null ? null : { label: 'Duration', value: duration };

    if (!this.isMultiMessage()) {
      const message = turn.messages[0];
      if (!message) return present([durationItem]);
      return present([
        durationItem,
        messageDurationItem('Message duration', message),
        messageTokensItem(message.tokens),
        messageCostItem(message.cost),
        countItem('Tool calls', message.toolCount),
        countItem('Files changed', message.filesChanged),
      ]);
    }

    const totals = summarizeTurnMetrics(turn);
    const n = totals.messageCount;
    return present([
      durationItem,
      totals.tokens
        ? {
            label: coverageLabel('Tokens', totals.tokens.knownCount, n),
            value: tokensText(totals.tokens),
          }
        : null,
      totals.cost
        ? {
            label: coverageLabel('Cost', totals.cost.knownCount, n),
            value: formatUsdCost(totals.cost.value) ?? '',
          }
        : null,
      countItem('Tool calls', totals.toolCount.value),
      countItem('Files changed', totals.filesChanged.value),
    ]).filter((item) => item.value.length > 0);
  });

  /** One section per assistant message for N > 1; empty otherwise. */
  protected readonly sections = computed<readonly MessageSection[]>(() => {
    if (!this.isMultiMessage()) return [];
    const messages = this.turn().messages;
    const total = messages.length;
    return messages
      .map((message, i) => ({
        id: message.id,
        ariaLabel: `Message ${i + 1} of ${total}`,
        heading: `Message ${i + 1}`,
        time: timeOf(message.timestamp),
        items: present([
          messageDurationItem('Duration', message),
          messageTokensItem(message.tokens),
          messageCostItem(message.cost),
          countItem('Tool calls', message.toolCount),
          countItem('Files changed', message.filesChanged),
        ]),
      }))
      .filter((section) => section.items.length > 0);
  });
}

/** Pure dashboard formatting and UTC day labels. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** Hard stop for day enumeration so a broken window cannot loop forever. */
const MAX_WINDOW_DAYS = 400;

// ---------------------------------------------------------------------------
// Formatting (pure; the components reuse these so every surface agrees)
// ---------------------------------------------------------------------------

const usdFormat = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});
const compactUsdFormat = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});
const smallUsdFormat = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumSignificantDigits: 2,
});
const compactTokenFormat = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
const percentFormat = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 1,
});
const shortDayFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});
const shortDayYearFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

/** "$1,234.56" — the big total and table costs. */
export function formatUsd(value: number): string {
  return usdFormat.format(value);
}

/** "$1.2K" — chart axis labels and compact cost chips. */
export function formatCompactUsd(value: number): string {
  return compactUsdFormat.format(value);
}

/**
 * Chart axis and readout values: sub-dollar amounts keep two significant
 * digits so small scales never collapse to identical "$0" labels.
 */
export function formatChartUsd(value: number): string {
  if (value > 0 && value < 1) return smallUsdFormat.format(value);
  return compactUsdFormat.format(value);
}

/** "48B", "46.2M" — token counts everywhere. */
export function formatCompactTokens(value: number): string {
  return compactTokenFormat.format(value);
}

/** "34.3%" — share columns and quality panel. */
export function formatPercent(value: number): string {
  return percentFormat.format(value);
}

/** "Oct 14" for a "2026-10-14" UTC day. */
export function formatDayShort(day: string): string {
  const ms = parseUtcDay(day);
  return Number.isNaN(ms) ? day : shortDayFormat.format(ms);
}

// ---------------------------------------------------------------------------
// Day-window helpers
// ---------------------------------------------------------------------------

function parseUtcDay(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`);
}

function nextUtcDay(day: string): string {
  return new Date(parseUtcDay(day) + DAY_MS).toISOString().slice(0, 10);
}

/** Every UTC day in `[fromDay, untilDayExclusive)`, oldest first. */
export function enumerateDays(
  fromDay: string,
  untilDayExclusive: string,
): string[] {
  const from = parseUtcDay(fromDay);
  const until = parseUtcDay(untilDayExclusive);
  if (Number.isNaN(from) || Number.isNaN(until) || until <= from) return [];
  const days: string[] = [];
  let cursor = fromDay;
  while (parseUtcDay(cursor) < until && days.length < MAX_WINDOW_DAYS) {
    days.push(cursor);
    cursor = nextUtcDay(cursor);
  }
  return days;
}

/** "Oct 14 – Oct 20, 2026" for the header's date span. */
export function daySpanLabel(days: readonly string[]): string {
  if (days.length === 0) return '';
  const first = parseUtcDay(days[0]!);
  const last = parseUtcDay(days[days.length - 1]!);
  if (Number.isNaN(first) || Number.isNaN(last)) {
    return days.length === 1 ? days[0]! : `${days[0]} – ${days[days.length - 1]}`;
  }
  const sameYear =
    new Date(first).getUTCFullYear() === new Date(last).getUTCFullYear();
  const right = shortDayYearFormat.format(last);
  return sameYear
    ? `${shortDayFormat.format(first)} – ${right}`
    : `${shortDayYearFormat.format(first)} – ${right}`;
}

// ---------------------------------------------------------------------------
// Provider display names (ids in facts are machine slugs)
// ---------------------------------------------------------------------------

const PROVIDER_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  anthropic: 'Anthropic',
  'claude-cli': 'Claude CLI',
  'openai-codex': 'OpenAI Codex',
  codex: 'Codex',
  opencode: 'OpenCode',
  'opencode-go': 'OpenCode Go',
  'opencode-zen': 'OpenCode Zen',
  antigravity: 'Antigravity',
  'github-copilot': 'GitHub Copilot',
  copilot: 'Copilot',
  ollama: 'Ollama',
  'ollama-cloud': 'Ollama Cloud',
  openrouter: 'OpenRouter',
  moonshot: 'Moonshot',
  'z-ai': 'Z.ai',
  grok: 'Grok',
};

/** Readable provider name; unknown ids fall back to a title-cased slug. */
export function providerDisplayName(providerId: string): string {
  if (Object.hasOwn(PROVIDER_DISPLAY_NAMES, providerId)) {
    return PROVIDER_DISPLAY_NAMES[providerId]!;
  }
  return providerId
    .split(/[-._]/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

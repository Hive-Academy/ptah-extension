/**
 * Output formatter — JSON-RPC NDJSON (default) vs human-readable pretty
 * printer.
 *
 * Both formatters share a common `Formatter` interface so commands and the
 * event-pipe can stay agnostic of which mode is active. The factory
 * `buildFormatter(globals)` resolves the mode from the global flags and
 * environment (`NO_COLOR`, `--no-color`).
 *
 * `JsonFormatter` writes via the shared `StdoutWriter` so backpressure +
 * serial ordering are honored. `HumanFormatter` does the same; ANSI color
 * codes are emitted inline (no `chalk` dep — task constraint).
 */

import {
  encodeError,
  encodeNotification,
  encodeRequest,
  encodeResponse,
} from '../jsonrpc/encoder.js';
import type { RequestId } from '../jsonrpc/types.js';
import { StdoutWriter } from '../io/stdout-writer.js';

/** Subset of resolved global flags the formatter cares about. */
export interface FormatterGlobals {
  human?: boolean;
  noColor?: boolean;
  quiet?: boolean;
}

/**
 * Cross-mode formatter contract. Each method returns a promise that resolves
 * once the underlying writer accepts the chunk.
 */
export interface Formatter {
  writeNotification(method: string, params?: unknown): Promise<void>;
  writeRequest(id: RequestId, method: string, params?: unknown): Promise<void>;
  writeResponse(id: RequestId | null, result: unknown): Promise<void>;
  writeError(
    id: RequestId | null,
    code: number,
    message: string,
    data?: unknown,
  ): Promise<void>;
  /** Flush + release any held resources. Idempotent. */
  close(): Promise<void>;
}

/** JSON-RPC NDJSON formatter (the default). */
export class JsonFormatter implements Formatter {
  constructor(private readonly writer: StdoutWriter) {}

  writeNotification(method: string, params?: unknown): Promise<void> {
    return this.writer.write(encodeNotification(method, params));
  }

  writeRequest(id: RequestId, method: string, params?: unknown): Promise<void> {
    return this.writer.write(encodeRequest(id, method, params));
  }

  writeResponse(id: RequestId | null, result: unknown): Promise<void> {
    return this.writer.write(encodeResponse(id, result));
  }

  writeError(
    id: RequestId | null,
    code: number,
    message: string,
    data?: unknown,
  ): Promise<void> {
    return this.writer.write(encodeError(id, code, message, data));
  }

  close(): Promise<void> {
    return this.writer.flush();
  }
}

/** Minimal ANSI palette — intentionally hand-rolled (no `chalk` dep). */
const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
} as const;

type AnsiKey = keyof typeof ANSI;

/** Decide whether color is allowed for the current invocation. */
export function shouldUseColor(globals: FormatterGlobals = {}): boolean {
  if (globals.noColor) return false;
  if (typeof process !== 'undefined' && process.env) {
    if (
      process.env['NO_COLOR'] !== undefined &&
      process.env['NO_COLOR'] !== ''
    ) {
      return false;
    }
    if (process.env['PTAH_NO_TTY'] === '1') return false;
  }
  return true;
}

/** Method suffixes that denote a successful mutation / completion. */
const CONFIRMATION_SUFFIXES = [
  '.set',
  '.updated',
  '.removed',
  '.cleared',
  '.complete',
] as const;

/** True when `method` ends with a confirmation/completion suffix. */
function isConfirmationSuffix(method: string): boolean {
  return CONFIRMATION_SUFFIXES.some((suffix) => method.endsWith(suffix));
}

/**
 * Provider/config mutation notifications that get a dedicated one-line
 * confirmation render (success glyph + verb + salient field).
 */
const CONFIRMATION_METHODS = new Set<string>([
  'provider.key.set',
  'provider.key.removed',
  'provider.default',
  'provider.default.updated',
  'provider.tier.updated',
  'provider.tier.cleared',
  'provider.base_url.set',
  'provider.base_url.cleared',
  'provider.ollama.endpoint.set',
  'provider.ollama.endpoint.cleared',
]);

/**
 * Field names a confirmation render surfaces, in priority order. The first
 * matching scalar fields are appended to the confirmation line.
 */
const CONFIRMATION_SALIENT_KEYS = [
  'provider',
  'tier',
  'model',
  'baseUrl',
  'endpoint',
  'default',
  'defaultProvider',
] as const;

/** Column order of the `harness.doctor` per-target table. */
const HARNESS_DOCTOR_COLUMNS = [
  'target',
  'detected',
  'skills',
  'commands',
  'agents',
  'mcp',
  'expected',
  'found',
  'missing',
  'foreign',
  'writeFailed',
  'overwritten',
] as const;

/**
 * How many paths one `harness.doctor` list prints before it summarizes.
 *
 * Enough to name every gap in a normal workspace, small enough that a target
 * with a pathological count cannot bury the other five. `--json` carries the
 * full arrays either way.
 */
const HARNESS_PATH_LIST_LIMIT = 20;

/** Severity colour for the `harness.doctor` status line. */
const HARNESS_LEVEL_COLORS: Readonly<Record<string, AnsiKey>> = {
  ok: 'green',
  degraded: 'yellow',
  error: 'red',
  unknown: 'gray',
};

/**
 * Pretty-printer for `--human` mode. Renders each event as a one- or
 * two-line summary with a colored prefix and indented key/value body. Does
 * NOT emit JSON-RPC envelope — the human view is a debugging convenience,
 * not a machine contract.
 */
export class HumanFormatter implements Formatter {
  private readonly useColor: boolean;

  constructor(
    private readonly writer: StdoutWriter,
    globals: FormatterGlobals = {},
  ) {
    this.useColor = shouldUseColor(globals);
  }

  writeNotification(method: string, params?: unknown): Promise<void> {
    const pretty = this.prettyPrintForMethod(method, params);
    if (pretty !== null) {
      return this.writer.write(pretty);
    }
    const prefix = this.color(this.prefixFor(method), this.colorFor(method));
    const body = params === undefined ? '' : ` ${this.format(params)}`;
    return this.writer.write(`${prefix} ${method}${body}\n`);
  }

  writeRequest(id: RequestId, method: string, params?: unknown): Promise<void> {
    const prefix = this.color('?', 'cyan');
    const idTag = this.color(`#${String(id)}`, 'dim');
    const body = params === undefined ? '' : ` ${this.format(params)}`;
    return this.writer.write(`${prefix} ${method} ${idTag}${body}\n`);
  }

  writeResponse(id: RequestId | null, result: unknown): Promise<void> {
    const prefix = this.color('<', 'green');
    const idTag = this.color(`#${String(id ?? 'null')}`, 'dim');
    return this.writer.write(`${prefix} ${idTag} ${this.format(result)}\n`);
  }

  writeError(
    id: RequestId | null,
    code: number,
    message: string,
    data?: unknown,
  ): Promise<void> {
    const prefix = this.color('!', 'red');
    const idTag = this.color(`#${String(id ?? 'null')}`, 'dim');
    const codeTag = this.color(`(${code})`, 'yellow');
    const dataPart = data === undefined ? '' : ` ${this.format(data)}`;
    return this.writer.write(
      `${prefix} ${idTag} ${codeTag} ${message}${dataPart}\n`,
    );
  }

  close(): Promise<void> {
    return this.writer.flush();
  }

  private prefixFor(method: string): string {
    if (isConfirmationSuffix(method)) return '✓';
    if (method.startsWith('task.')) return '*';
    if (method.startsWith('agent.')) return '>';
    if (method.startsWith('session.')) return '~';
    if (method.startsWith('debug.')) return '.';
    return '-';
  }

  private colorFor(method: string): AnsiKey {
    if (method.endsWith('.error')) return 'red';
    if (isConfirmationSuffix(method)) return 'green';
    if (method.startsWith('agent.tool')) return 'magenta';
    if (method.startsWith('agent.')) return 'blue';
    if (method.startsWith('session.')) return 'yellow';
    if (method.startsWith('debug.')) return 'gray';
    return 'cyan';
  }

  private color(text: string, key: AnsiKey): string {
    if (!this.useColor) return text;
    return `${ANSI[key]}${text}${ANSI.reset}`;
  }

  private format(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  /**
   * Pretty-print a `*.status` / `*.list` / `provider.models` /
   * `provider.tiers` / `provider.base_url` notification as a small table.
   * Returns `null` for methods we don't render specially (caller falls
   * back to the prefixed-JSON line).
   *
   * Honors the same `useColor` flag as everything else; pure string output,
   * no external deps.
   */
  private prettyPrintForMethod(method: string, params: unknown): string | null {
    if (params === null || typeof params !== 'object') return null;
    const obj = params as Record<string, unknown>;

    if (method === 'provider.status') {
      return this.renderProviderStatus(obj);
    }
    if (method === 'provider.models') {
      return this.renderProviderModels(obj);
    }
    if (method === 'provider.tiers') {
      return this.renderProviderTiers(obj);
    }
    if (
      method === 'provider.base_url' ||
      method === 'provider.ollama.endpoint'
    ) {
      return this.renderProviderBaseUrl(method, obj);
    }
    if (method === 'auth.status') {
      return this.renderAuthStatus(obj);
    }
    if (method === 'config.list') {
      return this.renderConfigList(obj);
    }
    if (method === 'doctor.report') {
      return this.renderDoctorReport(obj);
    }
    if (method === 'harness.doctor') {
      return this.renderHarnessDoctor(obj);
    }
    if (
      method === 'license.status' ||
      method === 'license.updated' ||
      method === 'license.cleared'
    ) {
      return this.renderLicense(method, obj);
    }
    if (CONFIRMATION_METHODS.has(method)) {
      return this.renderConfirmation(method, obj);
    }
    return null;
  }

  /**
   * Render the `license.*` family. Reuses the same field shape as the License
   * section of `doctor.report` (tier / valid / daysRemaining / expiryWarning).
   */
  private renderLicense(method: string, obj: Record<string, unknown>): string {
    const lines: string[] = [];
    lines.push(this.color(`✓ ${method}`, this.colorFor(method)));
    lines.push(this.renderLicenseFields(obj));
    return `${lines.join('\n')}\n`;
  }

  /**
   * Shared License field renderer — used by both `renderDoctorReport` and
   * `renderLicense`. Returns the indented body (no trailing newline).
   */
  private renderLicenseFields(license: Record<string, unknown>): string {
    const lines: string[] = [];
    const tier = stringField(license, 'tier') || '(unknown)';
    const valid = booleanField(license, 'valid') ? 'yes' : 'no';
    const days =
      typeof license['daysRemaining'] === 'number'
        ? String(license['daysRemaining'])
        : '(none)';
    const warn = stringField(license, 'expiryWarning');
    const expiry =
      stringField(license, 'expiresAt') || stringField(license, 'expiry');
    lines.push(`    tier:           ${tier}`);
    lines.push(`    valid:          ${valid}`);
    lines.push(`    daysRemaining:  ${days}`);
    if (expiry) {
      lines.push(`    expiresAt:      ${expiry}`);
    }
    if (warn) {
      const warnColor: AnsiKey = warn === 'critical' ? 'red' : 'yellow';
      lines.push(`    expiryWarning:  ${this.color(warn, warnColor)}`);
    }
    return lines.join('\n');
  }

  /**
   * Render a mutation/confirmation notification (`provider.default.updated`,
   * `provider.key.set`, `provider.base_url.cleared`, ...) as a single success
   * line: a green glyph + the method verb + the salient field(s). Falls back
   * to the prefixed JSON line only if no recognizable field is present.
   */
  private renderConfirmation(
    method: string,
    obj: Record<string, unknown>,
  ): string {
    const glyph = this.color('✓', 'green');
    const parts: string[] = [];
    for (const key of CONFIRMATION_SALIENT_KEYS) {
      const value = obj[key];
      if (typeof value === 'string' && value.length > 0) {
        parts.push(`${key}=${value}`);
      } else if (typeof value === 'boolean' || typeof value === 'number') {
        parts.push(`${key}=${String(value)}`);
      }
    }
    const tail = parts.length > 0 ? `  ${parts.join('  ')}` : '';
    return `${glyph} ${method}${tail}\n`;
  }

  /**
   * Render a `doctor.report` notification as a multi-section human view.
   *
   * Sections (in order):
   *   1. License — tier / valid / daysRemaining / expiryWarning
   *   2. Auth    — authMethod / defaultProvider / anthropicProviderId
   *   3. Providers — table (id, type, status)
   *   4. Effective — route / ready / blockers (one per line)
   *
   * Only the doctor.report render lives here. Other formatter sections
   * must NOT be touched.
   */
  private renderDoctorReport(obj: Record<string, unknown>): string {
    const lines: string[] = [];
    const header = this.color('* doctor.report', 'cyan');
    lines.push(header);
    const license = (obj['license'] ?? null) as Record<string, unknown> | null;
    if (license) {
      lines.push(this.color('  License', 'bold'));
      lines.push(this.renderLicenseFields(license));
    }
    const auth = (obj['auth'] ?? null) as Record<string, unknown> | null;
    if (auth) {
      lines.push(this.color('  Auth', 'bold'));
      const method = stringField(auth, 'authMethod') || '(unset)';
      const def = stringField(auth, 'defaultProvider') || '(unset)';
      const anth = stringField(auth, 'anthropicProviderId') || '(none)';
      lines.push(`    authMethod:           ${method}`);
      lines.push(`    defaultProvider:      ${def}`);
      lines.push(`    anthropicProviderId:  ${anth}`);
    }
    const providers = Array.isArray(obj['providers'])
      ? (obj['providers'] as Array<Record<string, unknown>>)
      : [];
    if (providers.length > 0) {
      lines.push(this.color('  Providers', 'bold'));
      const rows: string[][] = providers.map((p) => [
        stringField(p, 'id'),
        stringField(p, 'type') || '(unknown)',
        stringField(p, 'status') || '(unknown)',
      ]);
      lines.push(renderTable(['id', 'type', 'status'], rows).trimEnd());
    }
    const effective = (obj['effective'] ?? null) as Record<
      string,
      unknown
    > | null;
    if (effective) {
      lines.push(this.color('  Effective', 'bold'));
      const route = stringField(effective, 'route') || '(unresolved)';
      const ready = booleanField(effective, 'ready') ? 'yes' : 'no';
      const readyColor: AnsiKey = booleanField(effective, 'ready')
        ? 'green'
        : 'red';
      lines.push(`    route:    ${route}`);
      lines.push(`    ready:    ${this.color(ready, readyColor)}`);
      const blockers = Array.isArray(effective['blockers'])
        ? (effective['blockers'] as unknown[])
        : [];
      if (blockers.length > 0) {
        lines.push('    blockers:');
        for (const b of blockers) {
          lines.push(
            `      - ${typeof b === 'string' ? b : JSON.stringify(b)}`,
          );
        }
      }
    }

    const ts = stringField(obj, 'timestamp');
    if (ts) {
      lines.push(this.color(`  (${ts})`, 'dim'));
    }
    return `${lines.join('\n')}\n`;
  }

  /**
   * Render a `harness.doctor` notification as one row per harness target.
   *
   * The four facet columns say whether a target can carry that artifact family
   * AT ALL, independent of whether the CLI is installed — Codex and Copilot
   * reject project prompt directories upstream, so `n/a` there is a permanent,
   * correct answer rather than a gap. A `source` cell is different: Ptah reads
   * that facet as editable input and deliberately does not write, manifest, or
   * reap it. Without those columns a reader would see `expected 0` and assume
   * something failed.
   *
   * `overwritten` is `overwrittenLocalEdit`, abbreviated to keep the row on one
   * terminal line.
   */
  private renderHarnessDoctor(obj: Record<string, unknown>): string {
    const lines: string[] = [];
    lines.push(this.color('* harness.doctor', 'cyan'));

    const health = (obj['health'] ?? null) as Record<string, unknown> | null;
    const summary = (obj['summary'] ?? null) as Record<string, unknown> | null;
    const targets =
      health !== null && Array.isArray(health['targets'])
        ? (health['targets'] as Array<Record<string, unknown>>)
        : [];

    lines.push(this.color('  Targets', 'bold'));
    const rows: string[][] = targets.map((target) => {
      const facets = (target['facets'] ?? null) as Record<
        string,
        unknown
      > | null;
      const facet = (name: string): string => {
        if (facets === null) return 'n/a';
        if (facets[name] === 'supported') return 'yes';
        if (facets[name] === 'source-managed') return 'source';
        return 'n/a';
      };
      return [
        stringField(target, 'target') || '(unknown)',
        booleanField(target, 'detected') ? 'yes' : 'no',
        facet('skills'),
        facet('commands'),
        facet('agents'),
        facet('mcp'),
        numberField(target, 'expected'),
        numberField(target, 'found'),
        countField(target, 'missing'),
        countField(target, 'foreign'),
        countField(target, 'writeFailed'),
        countField(target, 'overwrittenLocalEdit'),
      ];
    });
    lines.push(renderTable([...HARNESS_DOCTOR_COLUMNS], rows).trimEnd());
    lines.push(...this.harnessPathSections(targets));

    lines.push(this.color('  Summary', 'bold'));
    const sources =
      health !== null
        ? stringField(health, 'sources') || '(unknown)'
        : '(none)';
    lines.push(
      `    sources:     ${this.color(
        sources,
        sources === 'ok' ? 'green' : 'yellow',
      )}`,
    );
    const collisions =
      health !== null && Array.isArray(health['collisions'])
        ? health['collisions'].length
        : 0;
    lines.push(`    collisions:  ${String(collisions)}`);
    const level = summary !== null ? stringField(summary, 'level') : '';
    const label = summary !== null ? stringField(summary, 'label') : '';
    lines.push(
      `    status:      ${this.color(
        label || level || '(unknown)',
        HARNESS_LEVEL_COLORS[level] ?? 'gray',
      )}`,
    );
    return `${lines.join('\n')}\n`;
  }

  /**
   * The PATHS behind the count columns, grouped by kind then by target.
   *
   * A row reading `missing 15` tells a user their harness is broken and gives
   * them nothing to do about it; `.codex/agents/backend-developer.toml` tells
   * them where to look. `foreign` matters most of all — those are entries Ptah
   * is deliberately refusing to touch, so the only way out is for the user to
   * move or delete the file, and they cannot do that without its name.
   *
   * Capped per section rather than per target: a workspace where one target has
   * 200 gaps should not push the other five off the screen.
   */
  private harnessPathSections(
    targets: Array<Record<string, unknown>>,
  ): string[] {
    const sections: Array<{ key: string; title: string }> = [
      { key: 'missing', title: 'Missing (desired, not owned by Ptah on disk)' },
      { key: 'foreign', title: 'Foreign (present, not Ptah’s — left alone)' },
      { key: 'adopted', title: 'Adopted (proved to be Ptah’s, rewritten)' },
      { key: 'removed', title: 'Removed' },
    ];

    const lines: string[] = [];
    for (const { key, title } of sections) {
      const entries = targets.flatMap((target) => {
        const value = target[key];
        const name = stringField(target, 'target') || '(unknown)';
        return Array.isArray(value)
          ? value
              .filter((item): item is string => typeof item === 'string')
              .map((path) => `${name}  ${path}`)
          : [];
      });
      if (entries.length === 0) continue;

      lines.push(this.color(`  ${title}`, 'bold'));
      for (const entry of entries.slice(0, HARNESS_PATH_LIST_LIMIT)) {
        lines.push(`    ${entry}`);
      }
      if (entries.length > HARNESS_PATH_LIST_LIMIT) {
        lines.push(
          this.color(
            `    +${String(entries.length - HARNESS_PATH_LIST_LIMIT)} more`,
            'dim',
          ),
        );
      }
    }
    return lines;
  }

  private renderProviderStatus(obj: Record<string, unknown>): string {
    const providers = Array.isArray(obj['providers'])
      ? (obj['providers'] as Array<Record<string, unknown>>)
      : [];
    const defaultProvider =
      typeof obj['defaultProvider'] === 'string'
        ? (obj['defaultProvider'] as string)
        : '';

    const headers = [
      'name',
      'default',
      'auth mode',
      'key/auth',
      'base-url',
    ] as const;
    const rows: string[][] = [];
    for (const p of providers) {
      const name = stringField(p, 'name');
      const isDefault = booleanField(p, 'isDefault') ? 'yes' : '';
      const authType = stringField(p, 'authType') || 'apiKey';
      const hasApiKey = booleanField(p, 'hasApiKey');
      const isLocal = booleanField(p, 'isLocal');
      let keyStatus: string;
      if (authType === 'apiKey')
        keyStatus = hasApiKey ? 'configured' : 'missing';
      else if (authType === 'oauth') keyStatus = 'oauth';
      else if (authType === 'cli') keyStatus = 'cli';
      else if (authType === 'none') keyStatus = isLocal ? 'local' : 'none';
      else keyStatus = authType;

      const baseUrlRaw = p['baseUrl'];
      const baseUrl =
        typeof baseUrlRaw === 'string' && baseUrlRaw.length > 0
          ? baseUrlRaw
          : '(default)';
      const overridden = booleanField(p, 'baseUrlOverridden')
        ? `${baseUrl} [override]`
        : baseUrl;
      rows.push([name, isDefault, authType, keyStatus, overridden]);
    }

    const header = this.color('* provider.status', 'cyan');
    const meta =
      defaultProvider !== ''
        ? ` ${this.color(`(default=${defaultProvider})`, 'dim')}`
        : '';
    return `${header}${meta}\n${renderTable([...headers], rows)}`;
  }

  private renderProviderModels(obj: Record<string, unknown>): string {
    const provider = stringField(obj, 'provider');
    const models = Array.isArray(obj['models'])
      ? (obj['models'] as Array<Record<string, unknown>>)
      : [];
    const headers = ['id', 'displayName'];
    const rows: string[][] = models.map((m) => [
      stringField(m, 'id'),
      stringField(m, 'displayName') || stringField(m, 'name'),
    ]);
    const header = this.color(`- provider.models (${provider})`, 'cyan');
    return `${header}\n${renderTable(headers, rows)}`;
  }

  private renderProviderTiers(obj: Record<string, unknown>): string {
    const tiers = obj['tiers'];
    if (tiers === null || typeof tiers !== 'object') {
      return `${this.color('- provider.tiers', 'cyan')} ${this.format(obj)}\n`;
    }
    const t = tiers as Record<string, unknown>;
    const rows: string[][] = [];
    for (const tier of ['sonnet', 'opus', 'haiku']) {
      const value = t[tier];
      rows.push([
        tier,
        value === null || value === undefined ? '(default)' : String(value),
      ]);
    }
    const header = this.color('- provider.tiers', 'cyan');
    return `${header}\n${renderTable(['tier', 'model'], rows)}`;
  }

  private renderProviderBaseUrl(
    method: string,
    obj: Record<string, unknown>,
  ): string {
    const provider = stringField(obj, 'provider');
    const baseUrl =
      typeof obj['baseUrl'] === 'string' &&
      (obj['baseUrl'] as string).length > 0
        ? (obj['baseUrl'] as string)
        : null;
    const defaultBaseUrl =
      typeof obj['defaultBaseUrl'] === 'string'
        ? (obj['defaultBaseUrl'] as string)
        : null;
    const header = this.color(`- ${method} (${provider})`, 'cyan');
    const lines = [
      `  override: ${baseUrl ?? '(none)'}`,
      `  default:  ${defaultBaseUrl ?? '(none)'}`,
    ];
    return `${header}\n${lines.join('\n')}\n`;
  }

  private renderAuthStatus(obj: Record<string, unknown>): string {
    const lines: string[] = [];
    const header = this.color('* auth.status', 'cyan');
    const fields: Array<[string, string]> = [];
    const push = (label: string, key: string): void => {
      if (key in obj) {
        const v = obj[key];
        fields.push([label, formatScalar(v)]);
      }
    };
    push('authMethod', 'authMethod');
    push('Anthropic route', 'anthropicProviderId');
    push('hasApiKey', 'hasApiKey');
    push('hasAnyProviderKey', 'hasAnyProviderKey');
    push('copilot', 'copilotAuthenticated');
    push('codex', 'codexAuthenticated');
    push('claudeCli', 'claudeCliInstalled');
    if ('health' in obj && obj['health'] !== null) {
      const h = obj['health'] as Record<string, unknown>;
      const status = stringField(h, 'status');
      if (status) fields.push(['health.status', status]);
    }
    if ('apiKeyStatus' in obj && obj['apiKeyStatus'] !== null) {
      const a = obj['apiKeyStatus'] as Record<string, unknown>;
      const providers = Array.isArray(a['providers'])
        ? a['providers'].length
        : 0;
      fields.push(['apiKey.providers', String(providers)]);
    }

    for (const [label, value] of fields) {
      lines.push(`  ${label}: ${value}`);
    }
    if (lines.length === 0) {
      return `${header} ${this.format(obj)}\n`;
    }
    return `${header}\n${lines.join('\n')}\n`;
  }

  private renderConfigList(obj: Record<string, unknown>): string {
    const settings = obj['settings'];
    if (settings === null || typeof settings !== 'object') {
      return `${this.color('- config.list', 'cyan')} ${this.format(obj)}\n`;
    }
    const entries = Object.entries(settings as Record<string, unknown>);
    const rows = entries.map(([k, v]) => [k, formatScalar(v)]);
    const header = this.color('- config.list', 'cyan');
    return `${header}\n${renderTable(['key', 'value'], rows)}`;
  }
}

/**
 * Render a 2D table with column-aligned widths. Borders use plain ASCII so
 * they survive both ANSI and non-ANSI sinks. Column widths are computed from
 * the visual width of each cell (we do not strip ANSI here — callers should
 * pre-render colored cells before passing them in if exact widths matter).
 */
function renderTable(headers: string[], rows: string[][]): string {
  if (rows.length === 0) {
    return `  (empty) — ${headers.join(', ')}\n`;
  }
  const widths = headers.map((h, i) => {
    let w = h.length;
    for (const row of rows) {
      const cell = row[i] ?? '';
      if (cell.length > w) w = cell.length;
    }
    return w;
  });
  const line = (cells: string[]): string =>
    `  ${cells.map((c, i) => c.padEnd(widths[i])).join('  ')}`;
  const out: string[] = [];
  out.push(line(headers));
  out.push(line(widths.map((w) => '-'.repeat(w))));
  for (const row of rows) {
    out.push(line(headers.map((_, i) => row[i] ?? '')));
  }
  return `${out.join('\n')}\n`;
}

function stringField(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  return typeof v === 'string' ? v : '';
}

function booleanField(obj: Record<string, unknown>, key: string): boolean {
  return obj[key] === true;
}

/** Render a numeric field as a table cell; `-` when the field is absent. */
function numberField(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  return typeof v === 'number' ? String(v) : '-';
}

/** Render the LENGTH of an array field as a table cell. */
function countField(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  return Array.isArray(v) ? String(v.length) : '0';
}

function formatScalar(value: unknown): string {
  if (value === null || value === undefined) return '(none)';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean' || typeof value === 'number')
    return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export interface BuildFormatterOptions extends FormatterGlobals {
  /** Override the underlying writer (tests). */
  writer?: StdoutWriter;
}

/**
 * Resolve which formatter to instantiate based on global flags + env. The
 * caller may pre-supply a writer (e.g. tests with a `PassThrough` stream).
 */
export function buildFormatter(options: BuildFormatterOptions = {}): Formatter {
  const writer = options.writer ?? new StdoutWriter();
  if (options.human) {
    return new HumanFormatter(writer, options);
  }
  return new JsonFormatter(writer);
}

import { homedir, tmpdir } from 'node:os';
import type { Experiment } from './evidence-harness';
// Only literal harness messages, bounded RPC codes and known error names enter notes.
export const failureMessages = new Set([
  'frame too large',
  'Experiment path is a symlink',
  'Experiment overlaps a real Codex home',
  'Path escapes experiment',
  'Unsafe marker parent',
  'Unsafe marker ancestor',
  'Unsafe marker',
  'Marker changed during check',
  'Experiment root is a symlink',
  'Experiment setup failed (details withheld)',
  'Tree kill failed; cleanup cannot safely continue',
  'Unsafe sandbox rejected',
  'Invalid usage',
  'Cumulative usage ceiling reached',
  'unsupported server request',
  'child failed',
  'child closed',
  'invalid or oversized protocol frame',
  'stdin failed',
  'event limit reached',
  'experiment interrupted',
  'approval/isolation gate failed',
  'child stopped',
  'outbound frame too large',
  'not run: cap',
  'RPC timeout',
  'request write failed',
  'child teardown not confirmed',
  'Pinned binary/schema manifest mismatch',
  'Network disable not confirmed by config/read',
  'Observed path escapes experiment',
  'Observed symlink',
  'Unexpected marker effect',
  'Unexpected request',
  'Side effect before approval',
  'Side effect during approval',
  'Approval rejected by safety gate',
  'Notification thread mismatch',
  'Unexpected command',
  'Unexpected file change',
  'Unexpected or repeated tool item',
  'CODEX_HOME isolation mismatch',
  'Selected model not in first model/list page',
  'Effective config differs from bounded profile',
  'Effective approval policy differs from bounded profile',
  'No usage evidence; stop before further inference',
  'Planned turn budget exceeds cap',
  'Required: --run --binary <absolute native path> --auth-source <absolute auth.json> --model <id> --out <markdown path>',
  'Use a native executable',
  'Auth source must be auth.json',
  '--out must be a markdown artifact path',
  'Artifact destination overlaps source credentials',
  'Secret cleanup failed',
]);
export const errorNames = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'ReferenceError',
  'URIError',
  'EvalError',
  'AggregateError',
  'ZodError',
  'AbortError',
]);
export function recordCaseFailure(
  result: { notes?: string[] },
  error: unknown,
): void {
  const details = typeof error === 'object' && error !== null ? error : {};
  const message =
    'message' in details && typeof details.message === 'string'
      ? details.message
      : '';
  const name =
    'name' in details &&
    typeof details.name === 'string' &&
    errorNames.has(details.name)
      ? details.name
      : 'Error';
  const note =
    failureMessages.has(message) ||
    /^RPC error -?\d{1,6}$/.exec(message)?.[0] === message
      ? message
      : `unclassified error (${name})`;
  const notes = (result.notes ??= []);
  if (!notes.includes(note)) notes.push(note);
}

interface CommandShapeContext {
  experiment: Experiment;
  expectedCommand: string;
  markerScript: string;
  authDirectory?: string;
  sanitize: (value: unknown) => unknown;
}

/** Diagnostic only: never use normalized command text to make an approval decision. */
export function recordCommandShape(
  result: { notes?: string[] },
  params: Record<string, unknown>,
  fields: Record<string, unknown>,
  context: CommandShapeContext,
  kind: 'command' | 'file change' = 'command',
): void {
  const notes = (result.notes ??= []);
  const prefix = `Unexpected ${kind} shape: `;
  if (notes.some((note) => note.startsWith(prefix))) return;
  const variants = (value: string): string[] => [
    value,
    value.replace(/'/g, "''"),
    value.replace(/'/g, "'\\''"),
    JSON.stringify(value).slice(1, -1),
  ];
  const escape = (value: string): string =>
    value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const paths = [
    [context.experiment.root, '<ROOT>'],
    [context.experiment.home, '<HOME>'],
    [context.experiment.scratch, '<SCRATCH>'],
    [context.experiment.workspace, '<WORKSPACE>'],
    [process.execPath, '<NODE>'],
    [homedir(), '<USER_HOME>'],
    [tmpdir(), '<TMP>'],
    [process.cwd(), '<CWD>'],
    [process.env['CODEX_HOME'] ?? '', '<CODEX_HOME>'],
    [context.authDirectory ?? '', '<AUTH_DIR>'],
  ];
  const replacements = paths
    .flatMap(([path, placeholder]) =>
      [
        ...new Set(
          [path, path.replace(/\\/g, '/'), path.replace(/\//g, '\\')].flatMap(
            variants,
          ),
        ),
      ].map((value) => ({ value, placeholder })),
    )
    .sort((left, right) => right.value.length - left.value.length);
  const shape = (command: string): string => {
    let value = command;
    for (const script of variants(context.markerScript).sort(
      (left, right) => right.length - left.length,
    )) {
      if (script) value = value.split(script).join('<MARKER_SCRIPT>');
    }
    for (const replacement of replacements) {
      if (replacement.value)
        value = value.replace(
          new RegExp(
            escape(replacement.value),
            process.platform === 'win32' ? 'gi' : 'g',
          ),
          replacement.placeholder,
        );
    }
    return value.replace(/\s+/g, ' ').trim();
  };
  // Select command fields only; never stringify the request, environment, errors or model messages.
  const commands = ['command', 'commands'].flatMap((key) => {
    const value = fields[key];
    return typeof value === 'string'
      ? [value]
      : Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === 'string')
        : [];
  });
  const actual = shape(commands.join(' '));
  const expected = shape(context.expectedCommand);
  const unquote = (value: string): string =>
    value.replace(/["'`]/g, '').replace(/\s+/g, ' ').trim();
  const wrapper =
    /^(?:&\s+)?["']?(?:(?:[A-Za-z]:)?[^\s"']*[\\/])?(?:powershell|pwsh)(?:\.exe)?["']?\s+(?:(?:-NoProfile|-NonInteractive)\s+)*-(?:Command|c)\s+|^(?:["']?(?:(?:[A-Za-z]:)?[^\s"']*[\\/])?cmd(?:\.exe)?["']?\s+\/c\s+)|^(?:["']?(?:[^\s"']*\/)?(?:bash|sh)["']?\s+-(?:lc|c)\s+)/i;
  const withoutWrapper = actual.replace(wrapper, '');
  const difference =
    withoutWrapper !== actual && unquote(withoutWrapper) === unquote(expected)
      ? 'shell wrapper'
      : unquote(actual) === unquote(expected)
        ? 'quoting'
        : 'other';
  notes.push(
    prefix +
      String(
        context.sanitize(
          (actual || '<missing command>').replace(
            /[A-Za-z]:[\\/][^\s"'`<>]*|\\\\[^\s"'`<>]+|\/(?:home|Users)\/[^\s"'`<>]*|~\/[^\s"'`<>]*/g,
            '<PATH>',
          ),
        ),
      ).slice(0, 400),
  );
  notes.push(
    `Request param keys: ${Object.keys(params)
      .filter((key) => /^[a-z][A-Za-z0-9]{0,31}$/.test(key))
      .slice(0, 10)
      .join(', ')}`,
  );
  if (kind === 'command') notes.push(`Command differs by: ${difference}`);
}

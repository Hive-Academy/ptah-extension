import { homedir, tmpdir } from 'node:os';
import type { Experiment } from './evidence-harness';
// Only literal harness messages, bounded RPC codes and known error names enter notes.
export const failureMessages = new Set([
  'Tolerated marker read before command',
  'Tolerated read asked for approval',
  'exec-policy rule location unverified',
  'unverified: rule did not prompt',
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
  'Per-turn usage bound reached',
  'Cumulative usage bound reached',
  'turn/steer missing from manifest',
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
  'Command path contains a double quote',
  'Command path contains a backslash',
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
    let value = command.replace(
      /"(?:[A-Za-z]:[\\/]|\\\\)[^"\r\n]*[\\/](powershell\.exe|pwsh\.exe|cmd\.exe|bash|sh)"/gi,
      '"<PATH>\\$1"',
    );
    for (const script of [
      context.markerScript,
      context.markerScript.replace(/\\/g, '/'),
      context.markerScript.replace(/\//g, '\\'),
    ]
      .flatMap(variants)
      .sort((left, right) => right.length - left.length)) {
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
  const observed = commands.join(' ');
  const actual = shape(observed);
  const expected = context.expectedCommand;
  const acceptedWrapper =
    /^"((?:[A-Za-z]:[\\/]|\\\\[^"\\/]+[\\/][^"\\/]+[\\/])[^"\r\n]*)" -Command "([^"\r\n]*)"$/.exec(
      observed,
    );
  const inner =
    acceptedWrapper &&
    acceptedWrapper[0] === observed &&
    /[\\/](?:powershell|pwsh)\.exe$/i.test(acceptedWrapper[1]) &&
    !expected.includes('"')
      ? acceptedWrapper[2]
      : observed;
  const unquote = (value: string): string => value.replace(/["']/g, '');
  const whitespace = (value: string): string =>
    value.replace(/\s+/g, ' ').trim();
  const wrapper =
    /^(?:&\s+)?["']?(?:(?:[A-Za-z]:)?[^\s"']*[\\/])?(?:powershell|pwsh)(?:\.exe)?["']?\s+(?:(?:-NoProfile|-NonInteractive)\s+)*-(?:Command|c)\s+|^(?:["']?(?:(?:[A-Za-z]:)?[^\s"']*[\\/])?cmd(?:\.exe)?["']?\s+\/c\s+)|^(?:["']?(?:[^\s"']*\/)?(?:bash|sh)["']?\s+-(?:lc|c)\s+)/i;
  const withoutWrapper = observed.replace(wrapper, '');
  const wrapperInner = /^(?:"([\s\S]*)"|'([\s\S]*)')$/.exec(withoutWrapper);
  const unwrapped = wrapperInner
    ? (wrapperInner[1] ?? wrapperInner[2])
    : withoutWrapper;
  const difference =
    inner !== expected && inner.replace(/\\\\/g, '\\') === expected
      ? 'doubled backslashes'
      : inner !== expected &&
          inner.replace(/\\/g, '/') === expected.replace(/\\/g, '/')
        ? 'slash direction'
        : inner !== expected && inner.toLowerCase() === expected.toLowerCase()
          ? 'case only'
          : inner !== expected && whitespace(inner) === whitespace(expected)
            ? 'whitespace'
            : inner !== expected && unquote(inner) === unquote(expected)
              ? 'quoting'
              : inner === observed &&
                  withoutWrapper !== observed &&
                  unwrapped === expected
                ? 'wrapper'
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

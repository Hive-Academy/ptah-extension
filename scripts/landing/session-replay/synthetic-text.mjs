/**
 * Deterministic synthetic rewrite for replay text. It keeps the shape of the
 * text (prose, markdown, tool commands, envelopes) and replaces real details:
 * home and absolute paths, repository-relative paths and file names, worktree
 * and branch names, task ids, pull request numbers, tool-use ids, UUIDs, hex
 * ids, code identifiers, URLs, hosts, e-mail addresses and credential-shaped
 * values. Real names come only from the caller's runtime deny list; this file
 * holds no real term.
 */
import { createHash } from 'node:crypto';

const VERBS = ['load', 'build', 'sync', 'resolve', 'render', 'merge', 'track', 'parse', 'route', 'queue', 'watch', 'guard',
  'format', 'apply', 'fetch', 'store', 'check', 'scan', 'plan', 'draft', 'price', 'ship', 'sort', 'tag'];
const NOUNS = ['ledger', 'invoice', 'cart', 'order', 'badge', 'layout', 'filter', 'metric', 'ticket', 'theme', 'widget',
  'schedule', 'catalog', 'profile', 'report', 'budget', 'coupon', 'receipt', 'review', 'banner', 'quota', 'region',
  'shelf', 'voucher'];
const ROLE_SUFFIXES = ['Service', 'Store', 'Component', 'Handler', 'Event', 'Error', 'Reader', 'Builder', 'Registry',
  'Manager', 'Factory', 'Payload', 'Options', 'Result', 'Params', 'Spec', 'Module', 'Provider', 'Adapter'];
const KEEP_WORDS = new Set(['PtahCode', 'JavaScript', 'TypeScript', 'GitHub', 'GitLab', 'OpenAI', 'macOS', 'iOS', 'npm',
  'Node.js', 'README.md', 'CLAUDE.md', 'AGENTS.md', 'package.json', 'tsconfig.json', 'project.json', 'node_modules',
  'run_in_background', 'subagent_type', 'tool_use_id', 'file_path', 'old_string', 'new_string', 'replace_all',
  'NODE_ENV', 'HOME', 'PATH', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'UTF-8', 'SHA-256', 'JSON', 'JSONL', 'WebSocket',
  'PostgreSQL', 'SQLite', 'VS Code', 'VSCode', 'DevTools', 'ChatGPT']);
const KEEP_SEGMENTS = new Set(['src', 'lib', 'libs', 'app', 'apps', 'components', 'services', 'helpers', 'utils', 'shared',
  'core', 'backend', 'frontend', 'test', 'tests', 'spec', 'specs', 'docs', 'scripts', 'tools', 'reports', 'evidence',
  'assets', 'public', 'dist', 'node_modules', 'packages', 'api', 'ui', 'e2e', 'fixtures', 'index', 'README', 'CLAUDE',
  'AGENTS', 'HANDOFF', 'batches', 'decisions', 'context', 'task', 'implementation-plan', 'design-spec',
  'code-logic-review', 'code-style-review', 'test-report', 'package', 'project', 'tsconfig', 'main', 'workspace',
  'acme-app', '.ptah', '.github', 'worktrees', 'feat', 'fix', 'chore', 'docs', 'refactor', 'prototype', 'tmp', '.tmp',
  'bin', 'usr', 'local', 'dev', 'null', 'bash', 'sh', 'zsh', 'env', 'etc', 'opt', 'var', 'git', 'npm', 'npx', 'node', 'nx']);
const FILE_EXT = 'ts|tsx|js|mjs|cjs|json|jsonl|md|log|png|jpg|webm|scss|css|html|sh|yml|yaml|txt|sqlite|py';
const ALLOWED_SUFFIX = new Set(FILE_EXT.split('|').concat(['spec', 'test', 'component', 'service', 'store', 'handler',
  'handlers', 'types', 'd', 'config', 'module', 'entry', 'generated', 'scenario', 'utils', 'helpers']));
const KNOWN_ROOTS = new Set(['libs', 'apps', 'src', 'scripts', 'docs', 'tools', '.ptah', '.claude', 'dist', 'node_modules',
  'packages', 'task-tracking', 'evidence', 'reports']);
const COMMIT_TYPES = new Set(['feat', 'fix', 'chore', 'docs', 'refactor', 'test', 'perf', 'ci', 'build']);
const ISSUE_PREFIX_KEEP = new Set(['ACME', 'UTF', 'SHA', 'ES', 'ISO', 'RFC', 'GPT', 'HTTP', 'TLS', 'CVE', 'OWASP', 'WCAG', 'K']);

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const TOOLU = /\btoolu_(?!demo_)[A-Za-z0-9]+/g;
const SYNTHETIC_UUID = /^(?:(\d)\1{7}-\1{4}-4\1{3}-8\1{3}-\1{12}|00000000-0000-4000-8000-[0-9a-f]{12})$/i;
const HEX_ID = /(?<![\w-])(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}(?![\w-])/g;
const URL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>)\]`]+/gi;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const ABS_PATH = /(?<![\w.~<>-])(?:~\/|\/)(?:[\w.@+-]+\/)*[\w.@+-]+\/?/g;
const REL_PATH = /(?<![\w./@~<-])(?:\.{0,2}[\w@+-][\w.@+-]*\/)+[\w.@+-]+\/?/g;
const BARE_FILE = new RegExp(`(?<![\\w./-])[\\w-]+(?:\\.[\\w-]+)*\\.(?:${FILE_EXT})(?![\\w/])`, 'g');
const TASK_ID = /\bTASK_\d{4}_\d+(?:_[0-9a-z]+)?\b/g;
const ISSUE_KEY = /\b([A-Z][A-Z0-9]{1,9})-(\d+)\b/g;
const PR_REF = /\bPR #(\d+)/g;
const HASH_REF = /(?<![\w&])#(\d{3,})\b/g;
const CAMEL = /\b[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+\b/g;
const PASCAL = /\b[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+\b/g;
const SNAKE = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g;
const SCREAMING = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;
const PUBLIC_HOST = /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|net|org|io|dev|live|app|xyz|edu|gov|me|sh|cloud|tech|co|ai|internal|local|corp|lan|intranet)\b/gi;
const IPV4 = /(?<![\d.])\d{1,3}(?:\.\d{1,3}){3}\b/g;
const SECRET = /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|\b(?:sk-|(?:sk|pk|rk)_(?:live|test)_|github_pat_|gh[opusr]_|glpat-|xox[abps]-|sk-ant-|sk-proj-|AIza|npm_|hf_|AKIA|ASIA)[A-Za-z0-9_-]{8,}/g;
const CREDENTIAL = /((?<![A-Za-z0-9])(?:[A-Za-z0-9]+_)*(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|auth)(?:_[A-Za-z0-9]+)*\b["']?\s*[=:]\s*)(?:"[^"]*"|'[^']*'|<[^>]*>|\[[^\]]*\]|\$\{[^}]*\}|[^\s,;}\]]+)/gi;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/g;
const LONG_TOKEN = /(?:[A-Za-z0-9+/]{201,}={0,2}|[A-Za-z0-9_-]{201,})/g;

const capital = (word) => word[0].toUpperCase() + word.slice(1);

export class SyntheticRewriter {
  /**
   * @param {{ deny?: ReadonlyMap<string, string>, keep?: Iterable<string>, salt?: string }} options
   *   deny: real term -> synthetic replacement, discovered at runtime.
   *   keep: words that stay as they are (tool names, agent types, CLI names).
   *   internal: project names (library and app folders) that get a synthetic path segment.
   */
  constructor({ deny = new Map(), keep = [], internal = [], salt = 'ptahcode-demo' } = {}) {
    this.salt = salt;
    this.deny = [...deny.entries()].filter(([from]) => from && from.length >= 3)
      .sort((a, b) => b[0].length - a[0].length);
    this.keep = new Set([...KEEP_WORDS, ...keep, ...this.deny.map(([, to]) => to)]);
    for (const word of keep) for (const part of String(word).split(/__|[:/]/)) if (part) this.keep.add(part);
    this.maps = new Map();
    this.taken = new Map();
    this.internal = [...new Set(internal)].filter((name) => name.length >= 4 && !this.keep.has(name))
      .sort((a, b) => b.length - a.length);
  }

  digest(value, kind) {
    return createHash('sha256').update(`${this.salt}:${kind}:${value}`).digest();
  }

  /** One stable synthetic value per (kind, real value); collisions get a suffix. */
  unique(kind, value, make) {
    let map = this.maps.get(kind);
    if (!map) this.maps.set(kind, (map = new Map()));
    if (map.has(value)) return map.get(value);
    let taken = this.taken.get(kind);
    if (!taken) this.taken.set(kind, (taken = new Set()));
    // A value this rewriter produced stays as it is, so a second pass is a no-op.
    if (taken.has(value)) return value;
    let candidate = make(this.digest(value, kind), map.size + 1);
    for (let n = 2; taken.has(candidate); n++) candidate = `${make(this.digest(value, kind), map.size + 1)}${n}`;
    taken.add(candidate);
    map.set(value, candidate);
    return candidate;
  }

  words(value, kind) {
    const bytes = this.digest(value, kind);
    return [VERBS[bytes[0] % VERBS.length], NOUNS[bytes[1] % NOUNS.length], NOUNS[bytes[2] % NOUNS.length]];
  }

  uuid(value) {
    if (SYNTHETIC_UUID.test(value)) return value;
    return this.unique('uuid', value.toLowerCase(), (_b, n) => `00000000-0000-4000-8000-${(0x100 + n).toString(16).padStart(12, '0')}`);
  }

  hex(value) {
    return this.unique('hex', value.toLowerCase(), (bytes) => bytes.toString('hex').replace(/[0-9]/, 'a').slice(0, value.length));
  }

  identifier(token) {
    if (this.keep.has(token) || /^toolu_demo_\d+$|^TASK_DEMO_\d+$/.test(token)) return token;
    return this.unique('identifier', token, () => {
      const [verb, noun, noun2] = this.words(token, 'identifier');
      if (/^[A-Z][A-Z0-9_]+$/.test(token)) return `${noun}_${verb}`.toUpperCase();
      if (token.includes('_')) return `${verb}_${noun}`;
      if (/^[A-Z]/.test(token)) {
        const role = ROLE_SUFFIXES.find((suffix) => token.endsWith(suffix)) ?? '';
        return `${capital(noun)}${capital(noun2)}${role}`;
      }
      return `${verb}${capital(noun)}`;
    });
  }

  segment(segment) {
    if (!segment || segment === '.' || segment === '..' || this.keep.has(segment) || KEEP_SEGMENTS.has(segment)) return segment;
    const dot = segment.startsWith('.') ? '.' : '';
    const [stem, ...rest] = segment.slice(dot.length).split('.');
    if (KEEP_SEGMENTS.has(stem) && rest.every((part) => ALLOWED_SUFFIX.has(part))) return segment;
    const suffix = rest.filter((part) => ALLOWED_SUFFIX.has(part)).map((part) => `.${part}`).join('');
    const name = this.unique('segment', stem, () => {
      const [verb, noun] = this.words(stem, 'segment');
      return `${noun}-${verb}`;
    });
    return `${dot}${name}${suffix}`;
  }

  relativePath(path) {
    return path.split('/').map((part) => (part.startsWith('@') ? part : this.segment(part))).join('/');
  }

  absolutePath(path) {
    const body = path.replace(/^~\//, '/').replace(/^\/(?:home|Users)\/[^/]+(?:\/|$)/, '/').replace(/^\/root(?:\/|$)/, '/');
    if (body === '/workspace/acme-app' || body.startsWith('/workspace/acme-app/')) return body;
    const tmp = /^\/(?:tmp|var\/folders)\//.test(body);
    const relative = body.replace(/^\/(?:tmp|var\/folders\/[^/]+\/[^/]+)\//, '').replace(/^\//, '').replace(/^acme-app\/?/, '')
      .replace(/^worktrees\/[^/]+\/?/, (match) => match);
    const mapped = this.relativePath(relative);
    return `/workspace/acme-app${tmp ? '/.tmp' : ''}${mapped ? `/${mapped}` : ''}`;
  }

  /** Full rewrite for prose, tool input and output text. */
  text(input) {
    if (typeof input !== 'string' || !input) return input;
    let text = input.split('\n').map((line) => line.split('\r').filter(Boolean).pop() ?? '').join('\n');
    for (const [from, to] of this.deny) {
      const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      text = text.replace(new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'gi'), to);
    }
    for (const name of this.internal) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      text = text.replace(new RegExp(`(?<![A-Za-z0-9_-])${escaped}(?![A-Za-z0-9_-])`, 'g'), () => this.segment(name));
    }
    text = text.replace(/\.claude-worktrees\//g, 'worktrees/');
    text = text.replace(URL, 'https://ptah.live');
    text = text.replace(EMAIL, 'demo-user');
    text = this.ids(text);
    text = text.replace(TASK_ID, (id) => this.unique('task', id, (_b, n) => `TASK_DEMO_${n}`));
    text = text.replace(ISSUE_KEY, (match, prefix) => (ISSUE_PREFIX_KEEP.has(prefix) ? match
      : this.unique('issue', match, (_b, n) => `ACME-${100 + n}`)));
    text = text.replace(PR_REF, (_m, n) => `pull request #${this.number(n)}`);
    text = text.replace(HASH_REF, (_m, n) => `#${this.number(n)}`);
    text = text.replace(ABS_PATH, (path) => this.absolutePath(path));
    text = text.replace(REL_PATH, (path) => {
      const parts = path.replace(/\/$/, '').split('/');
      const pathLike = parts.length >= 3 || /\.[a-z]{1,6}$/i.test(parts.at(-1)) || KNOWN_ROOTS.has(parts[0])
        || COMMIT_TYPES.has(parts[0]) || parts[0].startsWith('@');
      return pathLike ? this.relativePath(path) : path;
    });
    text = text.replace(BARE_FILE, (file) => (this.keep.has(file) ? file : this.segment(file)));
    text = text.replace(SCREAMING, (token) => this.identifier(token));
    text = text.replace(SNAKE, (token) => this.identifier(token));
    text = text.replace(CAMEL, (token) => this.identifier(token));
    text = text.replace(PASCAL, (token) => this.identifier(token));
    text = text.replace(/\bPtah\b(?!Code)/g, 'PtahCode');
    return this.scrub(text);
  }

  /** Id fields: only identity values change, so ids stay consistent everywhere. */
  ids(input) {
    if (typeof input !== 'string' || !input) return input;
    return input
      .replace(TOOLU, (id) => this.unique('toolu', id, (_b, n) => `toolu_demo_${n}`))
      .replace(UUID, (id) => this.uuid(id))
      .replace(HEX_ID, (id) => this.hex(id));
  }

  number(value) {
    return this.unique('number', value, (bytes) => String(100 + (bytes.readUInt16BE(0) % 800)));
  }

  /** Mirrors the landing privacy scan so no credential-, host- or IP-shaped text survives. */
  scrub(text) {
    return text
      .replace(SECRET, '<redacted>')
      .replace(BEARER, '$1 <redacted>')
      .replace(CREDENTIAL, '$1<redacted>')
      .replace(LONG_TOKEN, (token) => `${token.slice(0, 24)}…`)
      .replace(PUBLIC_HOST, (host) => (/(?:^|\.)ptah\.live$/i.test(host) ? host : 'example.invalid'))
      .replace(IPV4, '0.0.0');
  }
}

/** Cut text at a sentence or line end near `limit` characters. */
export function truncate(text, limit) {
  if (typeof text !== 'string' || text.length <= limit) return text;
  const head = text.slice(0, limit);
  const cut = Math.max(head.lastIndexOf('\n'), head.lastIndexOf('. '));
  return `${(cut > limit * 0.5 ? head.slice(0, cut + 1) : head.replace(/\s+\S*$/, '')).trimEnd()}…`;
}

/** First `lines` non-empty lines of a tool output, capped at `limit` characters. */
export function excerpt(text, lines, limit) {
  if (typeof text !== 'string') return text;
  const kept = text.split('\n').filter((line) => line.trim()).slice(0, lines).join('\n');
  return truncate(kept, limit);
}

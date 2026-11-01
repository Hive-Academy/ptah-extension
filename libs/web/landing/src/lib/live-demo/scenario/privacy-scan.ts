export interface PrivacyFinding {
  readonly path: string;
  readonly kind: string;
}

const safeCredentialFields = new Set(['hasApiKey', 'hasOpenRouterKey', 'hasAnyProviderKey']);
const credentialField = /(?:^|[_-])(api[_-]?key|token|secret|password|authorization|cookie)(?:$|[_-])/i;
const camelCredentialField = /(?:apiKey|Token|Secret|Password|Authorization|Cookie)$/;
const email = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const syntheticCommitEmail = 'demo@example.invalid';
const home = /(?:\/home\/|\/Users\/|C:[\\/]Users[\\/]|~\/|\/root(?:\/|\b)|\/var\/folders\/)/i;
const url = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi;
const hostname = /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}\b/gi;
// Bare names with other suffixes require URL, // or @ context to avoid code identifiers.
const publicSuffix = new Set(['com', 'net', 'org', 'io', 'dev', 'live', 'app', 'xyz', 'edu', 'gov', 'me', 'sh', 'cloud', 'tech']);
const fileSuffix = new Set(['ts', 'js', 'json']);
const ipv4 = /\d{1,3}(?:\.\d{1,3}){3}\b/g;
const ipv6 = /(?:^|[\s[(/])(?=[a-f\d:]*:[a-f\d:]*:)(?:[a-f\d]{0,4}:){2,}[a-f\d]{0,4}(?=$|[\s\]/),])/i;
const secretShape = /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|\b(?:sk-|(?:sk|pk|rk)_(?:live|test)_|github_pat_|gh[opusr]_|glpat-|xox[abps]-|sk-ant-|sk-proj-|AIza|npm_|hf_|AKIA|ASIA)[A-Za-z0-9_-]{8,}/i;
const credentialAssignment = /(?<![A-Za-z0-9])(?:[A-Za-z0-9]+_)*(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|auth)(?:_[A-Za-z0-9]+)*\b["']?\s*[=:]\s*(?:"([^"]*)"|'([^']*)'|(<[^>]*>|\[[^\]]*\]|\$\{[^}]*\}|[^\s,;}\]]+))/gi;
const authorization = /\b(?:Authorization\s*:\s*)?(Bearer\s+\S+|Basic\s+[A-Za-z0-9+/]+={0,2})/gi;
const pem = /-----BEGIN [A-Z ]*(?:PRIVATE KEY|CERTIFICATE)-----/;
const longBase64 = /(?:[A-Za-z0-9+/]{201,}={0,2}|[A-Za-z0-9_-]{201,})/;
const internalIdentifier = /\btoolu_[A-Za-z0-9]{8,}|\bPR #\d+|\.claude-worktrees\/|\bFIX_[A-Z_]+\b/;
const absolutePath = /(?:^|[\s"'=:(,{>]|\[)(?:\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*|[A-Z]:[\\/][^\s"']+)/g;

function isPlaceholder(value: string): boolean {
  const trimmed = value.trim();
  return !trimmed || /^\*+$/.test(trimmed) || /^<redacted>$/i.test(trimmed)
    || /^\[redacted\]$/i.test(trimmed) || /^\$\{[^}]+\}$/.test(trimmed)
    || /^process\.env\.[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed);
}

function isAllowedHost(host: string): boolean {
  return host === 'ptah.live' || host.endsWith('.ptah.live')
    || host === 'example.invalid' || host === 'example.com';
}

function isPrivateIpv4(parts: number[]): boolean {
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 169 && parts[1] === 254);
}

/** Pure, fail-closed scan of every JSON key and string. */
export function scanScenarioPrivacy(value: unknown): PrivacyFinding[] {
  const findings: PrivacyFinding[] = [];
  const add = (path: string, kind: string) => findings.push({ path, kind });
  const scanString = (text: string, path: string, allowSyntheticEmail = false, scanAssignments = true) => {
    for (const match of text.matchAll(email)) {
      if (!(allowSyntheticEmail && match[0] === syntheticCommitEmail)) add(path, 'email');
    }
    if (home.test(text)) add(path, 'home path');
    if (ipv6.test(text)) add(path, 'IP address');
    for (const match of text.matchAll(ipv4)) {
      if (match.index > 0 && /[\d.]/.test(text[match.index - 1])) continue;
      const parts = match[0].split('.').map(Number);
      if (parts.some((part) => part > 255)) continue;
      const before = text.slice(0, match.index);
      const hostContext = /(?:\/\/|\bhost(?:name)?\s*[:=]\s*)$/i.test(before) || /(?:^|\.|\[)(?:host|hostname)(?:\]|$)/i.test(path);
      const versionContext = /(?:^|\.|\[)(?:version|semver)(?:\]|$)/i.test(path) || /v$/i.test(before);
      if (isPrivateIpv4(parts) || hostContext || !versionContext) add(path, 'IP address');
    }
    if (scanAssignments) {
      for (const match of text.matchAll(credentialAssignment)) {
        const captured = match[1] ?? match[2] ?? match[3];
        if (!isPlaceholder(captured)) add(path, 'credential assignment');
      }
    }
    for (const match of text.matchAll(authorization)) {
      const credential = match[1].replace(/^(?:Bearer|Basic)\s+/i, '');
      if (!isPlaceholder(credential)) add(path, 'credential shape');
    }
    if (secretShape.test(text)) add(path, 'credential shape');
    if (pem.test(text)) add(path, 'PEM block');
    if (longBase64.test(text)) add(path, 'long base64');
    if (internalIdentifier.test(text)) add(path, 'internal identifier');
    for (const match of text.matchAll(url)) {
      try {
        const host = new URL(match[0]).hostname.toLowerCase();
        if (host && !isAllowedHost(host)) add(path, 'URL host');
      } catch { add(path, 'invalid URL'); }
    }
    for (const match of text.matchAll(hostname)) {
      const host = match[0].toLowerCase();
      const suffix = host.slice(host.lastIndexOf('.') + 1);
      const before = text.slice(0, match.index);
      const explicitContext = /(?:\/\/|@)$/.test(before);
      if (!isAllowedHost(host) && !fileSuffix.has(suffix)
        && (publicSuffix.has(suffix) || explicitContext)) add(path, 'hostname');
    }
    for (const match of text.matchAll(absolutePath)) {
      const candidate = match[0].trim().replace(/^(?:["'=:(,{>]|\[)/, '');
      if (!candidate.startsWith('/workspace/acme-app/') && candidate !== '/workspace/acme-app') add(path, 'absolute path');
    }
  };
  const visit = (item: unknown, path: string, allowSyntheticEmail = false) => {
    if (typeof item === 'string') { scanString(item, path, allowSyntheticEmail); return; }
    if (Array.isArray(item)) { item.forEach((child, index) => visit(child, `${path}[${index}]`)); return; }
    if (item && typeof item === 'object') {
      for (const [key, child] of Object.entries(item)) {
        const keyPath = `${path}.${key}`;
        scanString(key, `${keyPath} (key)`, false, false);
        if ((credentialField.test(key) || camelCredentialField.test(key)) && !(safeCredentialFields.has(key) && typeof child === 'boolean')) add(keyPath, 'credential field');
        visit(child, keyPath, key === 'authorEmail');
      }
    }
  };
  visit(value, '$');
  return findings;
}

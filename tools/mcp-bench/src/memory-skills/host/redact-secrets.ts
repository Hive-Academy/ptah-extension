/** Redacts credential-shaped text before it is retained in bench artefacts. */
export function redactSecrets(value: string): string {
  const secretKey =
    '[\\w-]*(?:token|secret|password|api[_-]?key|authorization|cookie|session)[\\w-]*';
  const keyValuePrefix = `((?:[\"']?${secretKey}[\"']?)\\s*[:=]\\s*)`;

  return value
    .replace(/((?:set-)?cookie\s*:\s*)[^\r\n]*/gi, '$1<redacted>')
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer <redacted>')
    .replace(
      new RegExp(`${keyValuePrefix}([\"'])(.*?)\\2`, 'gi'),
      '$1$2<redacted>$2',
    )
    .replace(
      new RegExp(`${keyValuePrefix}[^\\s,;}\"'\\]\\r\\n]+`, 'gi'),
      '$1<redacted>',
    )
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '<redacted-jwt>');
}

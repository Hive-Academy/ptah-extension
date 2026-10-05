/** Provisional, unverified Antigravity language-server protocol constants. */
export const ANTIGRAVITY_PROCESS_MARKER = 'language_server';
/** Required beside the generic server marker to exclude Windsurf/Codeium. */
export const ANTIGRAVITY_PRODUCT_MARKER = 'antigravity';
export const ANTIGRAVITY_CSRF_ARGUMENT = '--csrf_token';
export const ANTIGRAVITY_PORT_ARGUMENT = '--port';
export const ANTIGRAVITY_CSRF_HEADER = 'x-goog-csrf-token';
export const ANTIGRAVITY_POSIX_PROCESS_ARGS = [
  '-ax',
  '-o',
  'pid=,args=',
] as const;
export const ANTIGRAVITY_WINDOWS_PROCESS_ARGS = [
  '-NoProfile',
  '-Command',
  'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.CommandLine)" }',
] as const;
export const ANTIGRAVITY_STATUS_PATH =
  '/exa.language_server_pb.LanguageServerService/GetUserStatus';

import { z } from 'zod';

/**
 * LIVE-CONFIRMED: GetUserStatus needs this header, JSON body, content type,
 * Connect protocol version, and may listen on either HTTP or HTTPS. THIRD-
 * PARTY / PROVISIONAL: reply shape and extension-server arguments below.
 */
export const ANTIGRAVITY_PROCESS_MARKER = 'language_server';
export const ANTIGRAVITY_PRODUCT_MARKER = 'antigravity';
export const ANTIGRAVITY_CSRF_ARGUMENT = '--csrf_token';
export const ANTIGRAVITY_EXTENSION_PORT_ARGUMENT = '--extension_server_port';
export const ANTIGRAVITY_EXTENSION_CSRF_ARGUMENT =
  '--extension_server_csrf_token';
export const ANTIGRAVITY_CSRF_HEADER = 'X-Codeium-Csrf-Token';
export const ANTIGRAVITY_CONNECT_PROTOCOL_VERSION = '1';
export const ANTIGRAVITY_REQUEST_BODY = Object.freeze({
  metadata: Object.freeze({
    ideName: 'antigravity',
    extensionName: 'antigravity',
    ideVersion: 'unknown',
    locale: 'en',
  }),
});
export const ANTIGRAVITY_POSIX_PROCESS_ARGS = [
  '-ax',
  '-o',
  'pid=,args=',
] as const;
export const ANTIGRAVITY_WINDOWS_PROCESS_ARGS = [
  '-NoProfile',
  '-Command',
  'Get-CimInstance Win32_Process | Where-Object { $_.Name -match \'language_server\' } | ForEach-Object { $p=$_; "P $($p.ProcessId) $($p.CommandLine)"; Get-NetTCPConnection -State Listen -OwningProcess $p.ProcessId -ErrorAction SilentlyContinue | ForEach-Object { "L $($p.ProcessId) $($_.LocalPort)" } }',
] as const;
export const ANTIGRAVITY_STATUS_PATH =
  '/exa.language_server_pb.LanguageServerService/GetUserStatus';

export const AntigravityStatusSchema = z
  .object({
    userStatus: z
      .object({
        email: z.string().optional(),
        cascadeModelConfigData: z
          .object({
            clientModelConfigs: z.array(
              z
                .object({
                  label: z.string().optional(),
                  modelOrAlias: z
                    .object({ model: z.string().optional() })
                    .optional(),
                  quotaInfo: z
                    .object({
                      remainingFraction: z.number().min(0).max(1).optional(),
                      resetTime: z.string().optional(),
                    })
                    .optional(),
                })
                .passthrough(),
            ),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

/**
 * NullSessionAttachmentGuard — null-object default for
 * `ISessionAttachmentGuard` (port in `platform-core`).
 *
 * The gateway's real `AttachedSessionRegistry` is registered ONLY in the
 * Electron host. The shared chat RPC handler also runs in the VS Code host,
 * where no gateway (and therefore no registry) exists. Registering this
 * no-op under `PLATFORM_TOKENS.SESSION_ATTACHMENT_GUARD` in the
 * platform-agnostic bootstrap guarantees the token ALWAYS resolves, so the
 * handler can inject it unconditionally without `container.isRegistered`
 * guards or optional injection — the VS Code host simply gets `false`.
 *
 * The Electron host overrides this binding with `AttachedSessionRegistry`
 * (last `registerSingleton` wins in tsyringe), so attach enforcement is live
 * there.
 */
import { injectable } from 'tsyringe';
import type { ISessionAttachmentGuard } from '@ptah-extension/platform-core';

@injectable()
export class NullSessionAttachmentGuard implements ISessionAttachmentGuard {
  /** No gateway present: nothing is ever attached. */
  isAttached(_sessionUuid: string): boolean {
    return false;
  }
}

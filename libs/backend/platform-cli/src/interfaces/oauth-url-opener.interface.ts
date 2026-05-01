/**
 * IOAuthUrlOpener — collaborator that surfaces an OAuth verification URL +
 * device code to a downstream consumer (a JSON-RPC peer, stderr, etc).
 *
 * `CliUserInteraction.openOAuthUrl` delegates to this collaborator so the
 * platform-cli library never makes assumptions about whether stdio is
 * attached to a JSON-RPC peer. The CLI app composes the appropriate opener
 * (`JsonRpcOAuthUrlOpener` for `interact` mode, `StderrOAuthUrlOpener` for
 * one-shot commands) at command-entry time.
 *
 * Defined here (in `platform-cli`) rather than in `apps/ptah-cli` so the
 * platform layer has no upward dependency on the CLI app. The CLI app
 * imports this interface FROM `@ptah-extension/platform-cli` and provides
 * its concrete implementations.
 */

export interface IOAuthUrlOpener {
  openOAuthUrl(params: {
    provider: string;
    verificationUri: string;
    userCode?: string;
  }): Promise<{ opened: boolean; code?: string }>;
}

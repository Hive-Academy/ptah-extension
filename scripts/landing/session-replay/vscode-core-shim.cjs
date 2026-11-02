/**
 * Minimal stand-in for `@ptah-extension/vscode-core` so the converter can load
 * the agent-sdk history services outside VS Code. Those services only use
 * `TOKENS` inside `@inject(...)` decorators and `Logger` as a type; the
 * converter constructs them by hand with a silent logger.
 */
const TOKENS = new Proxy({}, { get: (_target, key) => Symbol.for(String(key)) });

class Logger {
  debug() {}
  info() {}
  warn() {}
  error() {}
}

module.exports = { TOKENS, Logger };

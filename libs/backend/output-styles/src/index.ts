/**
 * @ptah-extension/output-styles — public API.
 *
 * Owns the Claude Code output-style surface: the strict frontmatter contract,
 * safe slugging, the four built-ins, tier discovery, the style-file writer, the
 * opt-in CLI-parity settings writer and the activation resolver.
 *
 * Depends only on `shared`, `platform-core` (ports) and `vscode-core` (Logger).
 * Never on a platform adapter, never on `agent-sdk`, never on a frontend lib.
 */

// Frontmatter contract — the single pinned location (R4).
export {
  SDK_OUTPUT_STYLE_VERSION_PIN,
  OUTPUT_STYLE_FRONTMATTER_KEYS,
  OutputStyleFrontmatterSchema,
  type OutputStyleFrontmatter,
} from './lib/output-style-frontmatter.schema';

// Pure parse / serialize.
export {
  parseOutputStyleFile,
  serializeOutputStyleFile,
  normalizeFrontmatterKeys,
  deriveDescription,
  toValidationError,
  EMPTY_DESCRIPTION_FALLBACK,
  type ParsedOutputStyle,
  type ParseOutputStyleResult,
  type SerializeOutputStyleInput,
} from './lib/output-style-frontmatter';

// Slug safety (Req 3.4).
export {
  slugifyStyleName,
  styleFileName,
  MAX_SLUG_LENGTH,
  type SlugifyStyleNameResult,
} from './lib/output-style-slug';

// Built-ins (§8).
export {
  BUILT_IN_OUTPUT_STYLES,
  DEFAULT_OUTPUT_STYLE_NAME,
  isBuiltInOutputStyleName,
} from './lib/built-in-output-styles';

// Discovery + the path helpers the writers share.
export {
  OutputStyleDiscoveryService,
  OUTPUT_STYLES_DIR_SEGMENTS,
  FILE_OUTPUT_STYLE_TIERS,
  resolveHomeDirectory,
  userOutputStyleDirectory,
  projectOutputStyleDirectory,
  outputStyleDirectoryFor,
  toDisplayPath,
  type FileOutputStyleTier,
  type DiscoverOutputStylesOptions,
  type OutputStyleDiscoveryResult,
} from './lib/output-style-discovery.service';

// Style-file writer — upsert + delete + the E8 guard stamp.
export {
  OutputStyleFileWriter,
  type OutputStyleFileLocation,
  type OutputStyleGuardStamp,
  type OutputStyleFileTarget,
  type SaveOutputStyleParams,
  type SaveOutputStyleResult,
  type DeleteOutputStyleParams,
  type DeleteOutputStyleResult,
  type StatOutputStyleParams,
  type StatOutputStyleResult,
} from './lib/output-style-file.writer';

// Opt-in CLI-parity settings write (§4). NOT the activation mechanism.
export {
  ClaudeSettingsWriter,
  type SetOutputStyleParityParams,
} from './lib/claude-settings.writer';

// The single activation decision point (§3.2, R3).
export {
  resolveActivation,
  OutputStyleActivationResolver,
  LOCALHOST_BASE_URL_RE,
  type ResolveActivationInput,
} from './lib/output-style-activation.resolver';

// DI.
export { OUTPUT_STYLE_TOKENS, type OutputStyleDIToken } from './lib/di/tokens';
export { registerOutputStyleServices } from './lib/di/register';

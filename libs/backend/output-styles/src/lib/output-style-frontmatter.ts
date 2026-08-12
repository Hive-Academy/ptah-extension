/**
 * Pure parse / serialize for a Claude Code output-style `.md` file.
 *
 * No I/O lives here — callers hand in the file's text and its basename, which
 * keeps the module trivially testable and keeps every filesystem touch behind
 * `IFileSystemProvider` in the services that use it.
 *
 * `parseOutputStyleFile` NEVER throws past its boundary: every failure mode
 * becomes a typed `OutputStyleValidationError` carrying a PRE-FORMATTED
 * message. Raw exception text and absolute host paths never reach a caller
 * (Req 7.6) — the sanitiser below is what enforces that.
 */
import matter from 'gray-matter';
import { z } from 'zod';
import type {
  OutputStyleValidationError,
  OutputStyleUnrecognizedKeyError,
  OutputStyleYamlParseError,
} from '@ptah-extension/shared';
import {
  OUTPUT_STYLE_FRONTMATTER_KEYS,
  OutputStyleFrontmatterSchema,
  type OutputStyleFrontmatter,
} from './output-style-frontmatter.schema';
import { sanitizeDiagnostic } from './sanitize-diagnostic';

/**
 * Options handed to EVERY `matter()` call in this file. The option itself is
 * gray-matter's own default; passing ANY options object is the point, because
 * `index.js:36` takes its module-global cache branch only `if (!options)`.
 *
 * That cache stores the file object BEFORE parsing and then throws out of the
 * YAML engine, so the half-built entry survives with an empty `data` and the
 * SECOND call on identical bytes returns `{}` instead of throwing. A malformed
 * style file would then be diagnosed as "missing name" on one call and
 * "unparseable YAML" on the next, in the same process. Documented at
 * `libs/backend/task-specs/src/lib/task-frontmatter.ts` (MATTER_OPTIONS) after
 * the same bug was observed live there.
 */
const MATTER_OPTIONS = { language: 'yaml' } as const;

/** Longest derived description we will emit (Req 1.4). */
const DERIVED_DESCRIPTION_MAX = 160;

/** Shown when a style has neither a `description` nor any derivable body text. */
export const EMPTY_DESCRIPTION_FALLBACK = 'No description provided.';

/**
 * camelCase spelling → canonical kebab-case key. The SDK reads frontmatter
 * with `normalizeKeys: true`, so both spellings load there; Ptah's verdict has
 * to match the SDK's, which means folding BEFORE `.strict()` runs rather than
 * rejecting the camelCase file.
 */
const CAMEL_TO_KEBAB: Readonly<Record<string, string>> = Object.freeze({
  keepCodingInstructions: 'keep-coding-instructions',
  forceForPlugin: 'force-for-plugin',
});

/** A successfully parsed style file, already resolved to its downstream shape. */
export interface ParsedOutputStyle {
  /**
   * Frontmatter `name`, or the basename without `.md` when absent (E1).
   * Everything downstream binds on this, never on the filename.
   */
  readonly name: string;
  /** Frontmatter `description`, or a derived one-line body summary (Req 1.4). */
  readonly description: string;
  /** `keep-coding-instructions`. Absent and `false` both mean "replaces". */
  readonly keepCodingInstructions: boolean;
  /** Trimmed markdown body — this is what the SDK uses as the style prompt. */
  readonly body: string;
  /** The validated frontmatter, kebab-cased. */
  readonly frontmatter: OutputStyleFrontmatter;
}

export type ParseOutputStyleResult =
  | { readonly ok: true; readonly style: ParsedOutputStyle }
  | { readonly ok: false; readonly error: OutputStyleValidationError };

/** The four fields Ptah writes back out. `force-for-plugin` is never authored here (E7). */
export interface SerializeOutputStyleInput {
  readonly name: string;
  readonly description: string;
  readonly keepCodingInstructions: boolean;
  /** Markdown body, preserved verbatim (Req 4.3). */
  readonly body: string;
}

/**
 * Longest sanitised fragment of a foreign YAML diagnostic we will quote back.
 *
 * Larger than `claude-settings.writer.ts`'s cap on purpose: a parse reason is
 * the whole point of the message it lands in, not an aside inside a longer one.
 */
const MAX_DIAGNOSTIC_LENGTH = 120;

/** Strip a single leading UTF-8 BOM, which would otherwise defeat the `^---` anchor. */
function stripLeadingBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

/** `mark` as carried by a js-yaml `YAMLException`. Absent on some failures. */
interface YamlMark {
  readonly line?: number;
  readonly column?: number;
}

function readYamlMark(cause: unknown): YamlMark | undefined {
  if (typeof cause !== 'object' || cause === null) return undefined;
  const mark = (cause as { mark?: unknown }).mark;
  if (typeof mark !== 'object' || mark === null) return undefined;
  const { line, column } = mark as { line?: unknown; column?: unknown };
  return {
    line: typeof line === 'number' ? line : undefined,
    column: typeof column === 'number' ? column : undefined,
  };
}

/**
 * Fold the two camelCase spellings the SDK also accepts into their canonical
 * kebab-case keys, so `.strict()` sees exactly one form.
 *
 * When BOTH spellings are present the kebab-case value wins and the camelCase
 * key is dropped: the file specified the same setting twice, the canonical
 * spelling is the one Ptah writes, and reporting the duplicate as an
 * "unrecognised key" would name a key the SDK itself accepts.
 */
export function normalizeFrontmatterKeys(
  data: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const canonical = CAMEL_TO_KEBAB[key];
    if (canonical === undefined) {
      normalized[key] = value;
      continue;
    }
    if (!(canonical in data)) {
      normalized[canonical] = value;
    }
  }
  return normalized;
}

/**
 * First non-heading, non-empty paragraph of the body, collapsed to a single
 * line and capped at 160 characters (Req 1.4).
 */
export function deriveDescription(body: string): string {
  const lines = body.split(/\r?\n/);
  const paragraph: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      if (paragraph.length > 0) break;
      continue;
    }
    // Skip markdown headings, thematic breaks and fence markers — none of them
    // is a sentence a user would recognise as a description.
    if (/^(#{1,6}\s|-{3,}$|={3,}$|`{3,})/.test(trimmed)) {
      if (paragraph.length > 0) break;
      continue;
    }
    paragraph.push(trimmed);
  }

  const single = paragraph.join(' ').replace(/\s+/g, ' ').trim();
  if (single.length === 0) return EMPTY_DESCRIPTION_FALLBACK;
  return single.length > DERIVED_DESCRIPTION_MAX
    ? `${single.slice(0, DERIVED_DESCRIPTION_MAX - 1)}…`
    : single;
}

/**
 * Map anything thrown or returned by validation into a typed, display-ready
 * validation error.
 *
 * - A Zod `unrecognized_keys` issue becomes `UNRECOGNIZED_KEY`, naming the
 *   offending key and listing all four valid ones (Req 7.2).
 * - Any other Zod issue becomes `INVALID_VALUE`, naming the key.
 * - A `matter()` throw becomes `YAML_PARSE`, carrying `line`/`column` from the
 *   `YAMLException.mark` when the parser supplied one (Req 7.3).
 */
export function toValidationError(cause: unknown): OutputStyleValidationError {
  if (cause instanceof z.ZodError) {
    const issue = cause.issues[0];
    if (issue !== undefined && issue.code === 'unrecognized_keys') {
      const key = issue.keys[0] ?? 'unknown';
      const unrecognized: OutputStyleUnrecognizedKeyError = {
        code: 'UNRECOGNIZED_KEY',
        key,
        validKeys: OUTPUT_STYLE_FRONTMATTER_KEYS,
        message: `"${key}" is not a valid output-style setting. Valid settings are: ${OUTPUT_STYLE_FRONTMATTER_KEYS.join(', ')}.`,
      };
      return unrecognized;
    }
    const key =
      issue !== undefined && issue.path.length > 0
        ? String(issue.path[0])
        : undefined;
    return {
      code: 'INVALID_VALUE',
      key,
      message:
        key === undefined
          ? 'The style frontmatter is not valid.'
          : `"${key}" holds a value of the wrong type.`,
    };
  }

  // `matter()` only ever throws out of the YAML engine, so everything left is
  // a parse failure. The mark, when present, is relative to the frontmatter
  // block; gray-matter hands the engine the newline that CLOSES the opening
  // `---`, so `mark.line + 1` is already the 1-based line within the file.
  const mark = readYamlMark(cause);
  const reason =
    typeof (cause as { reason?: unknown })?.reason === 'string'
      ? sanitizeDiagnostic(
          (cause as { reason: string }).reason,
          MAX_DIAGNOSTIC_LENGTH,
        )
      : cause instanceof Error
        ? sanitizeDiagnostic(
            cause.message.split('\n')[0] ?? '',
            MAX_DIAGNOSTIC_LENGTH,
          )
        : '';

  const line =
    mark?.line !== undefined ? Math.max(1, mark.line + 1) : undefined;
  const column =
    mark?.column !== undefined ? Math.max(1, mark.column + 1) : undefined;

  const where = line === undefined ? '' : ` at line ${line}`;
  const detail = reason.length > 0 ? `: ${reason}` : '.';

  const yamlError: OutputStyleYamlParseError = {
    code: 'YAML_PARSE',
    line,
    column,
    message: `The style frontmatter is not valid YAML${where}${detail}`,
  };
  return yamlError;
}

/**
 * Parse one output-style file.
 *
 * @param content  Raw file text.
 * @param fileName Basename WITH extension (e.g. `my-style.md`). Used only for
 *                 the `name` fallback — never for binding (E1).
 */
export function parseOutputStyleFile(
  content: string,
  fileName: string,
): ParseOutputStyleResult {
  let raw: { data: unknown; content: string };
  try {
    const file = matter(stripLeadingBom(content), MATTER_OPTIONS);
    raw = { data: file.data, content: file.content };
  } catch (error: unknown) {
    return { ok: false, error: toValidationError(error) };
  }

  const data =
    typeof raw.data === 'object' && raw.data !== null
      ? (raw.data as Record<string, unknown>)
      : {};

  const parsed = OutputStyleFrontmatterSchema.safeParse(
    normalizeFrontmatterKeys(data),
  );
  if (!parsed.success) {
    return { ok: false, error: toValidationError(parsed.error) };
  }

  const frontmatter = parsed.data;
  const body = raw.content.trim();
  const name =
    frontmatter.name?.trim() || fileName.replace(/\.md$/i, '').trim();

  if (name.length === 0) {
    return {
      ok: false,
      error: {
        code: 'INVALID_VALUE',
        key: 'name',
        message:
          'The style has no name — add a `name` to the frontmatter or give the file a name.',
      },
    };
  }

  const description =
    frontmatter.description?.trim() || deriveDescription(body);

  return {
    ok: true,
    style: {
      name,
      description,
      // Absent and `false` both mean "replaces", matching the binary's
      // `(style === null || style.keepCodingInstructions === true)` assembly.
      keepCodingInstructions: frontmatter['keep-coding-instructions'] === true,
      body,
      frontmatter,
    },
  };
}

/**
 * Render a style file. Always emits kebab-case keys (§5.3) and always ends the
 * file with exactly one trailing newline.
 *
 * The `.replace(/\n$/, '')` is load-bearing: `matter.stringify` appends its own
 * separator newline after the closing `---`, and without stripping it a blank
 * line accumulates at the block/body boundary on EVERY save, which breaks
 * Req 4.3's "body preserved verbatim" one line at a time.
 */
export function serializeOutputStyleFile(
  input: SerializeOutputStyleInput,
): string {
  const data: Record<string, unknown> = {
    name: input.name,
    description: input.description,
    'keep-coding-instructions': input.keepCodingInstructions,
  };
  const block = matter.stringify('', data, MATTER_OPTIONS).replace(/\n$/, '');
  return `${block}\n${input.body}\n`;
}

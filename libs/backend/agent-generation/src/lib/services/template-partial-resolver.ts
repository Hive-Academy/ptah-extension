/**
 * Template partial resolver — the one place a shared agent block is expanded.
 *
 * ## Why this exists
 *
 * The 15 agent templates fenced their cross-cutting rules with
 * `<!-- STATIC:ID --> … <!-- /STATIC:ID -->` markers and then hand-copied the
 * content inside them. Nothing resolved the markers, so they leaked verbatim
 * into every generated agent file and into every rival CLI's harness dir, and
 * the copies drifted: the clarification protocol had 11 copies in 11 variants,
 * and all six copies of the task-spec rules still taught a filename that had
 * been renamed. A block that lives in one file cannot drift.
 *
 * ## The contract, in full
 *
 *  - A marker pair sits on its own lines. Whatever is BETWEEN them is replaced
 *    wholesale — templates may carry an empty pair or a stale body, and both
 *    resolve to the same output. The markers themselves survive resolution;
 *    `OrchestratorService.buildAgentFileContent` strips them on emit.
 *  - An id must match `/^[A-Z_]+$/` and must be one of {@link SHARED_BLOCK_IDS}.
 *    An unknown or malformed id is an ERROR, never a silent pass-through — the
 *    whole failure mode being fixed here is a marker that nothing acted on.
 *    `<!-- /STATIC:ANT I_PATTERNS -->` shipped for months because the validator's
 *    `\w+` could not see it; here it fails to match `/^[A-Z_]+$/` and stops the
 *    load.
 *  - Pairs must balance and must not nest.
 *  - After expansion, `{{SLOT}}` placeholders inside the expanded block are
 *    substituted from the template's frontmatter `variables` map. A slot with no
 *    declared value is an ERROR: an agent reading a literal `{{CLARIFY_TRIGGER}}`
 *    is being handed a broken instruction, which is worse than a failed load.
 *
 * ## Why TASK_SPEC_CONTRACT has no file
 *
 * It is rendered by `renderTaskSpecAgentBlock()` in `libs/shared`, next to the
 * constants it is derived from. A `_shared/task-spec-contract.md` would be a
 * seventh copy of the thing that already went stale in nineteen places.
 */
import { injectable, inject } from 'tsyringe';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { Result, renderTaskSpecAgentBlock } from '@ptah-extension/shared';
import { TemplateError } from '../errors/template.error';

/** Sub-directory of the templates dir holding the partial files. */
export const SHARED_PARTIALS_DIR = '_shared';

/**
 * The CLOSED set of shared block ids.
 *
 * Closed on purpose, and for the same reason `DOC_FILES` is: a template that
 * invents its own block id is re-opening the copy-paste path this resolver
 * exists to close. Widening the set is a deliberate edit here plus a new file
 * in `_shared/` (or a new renderer, for a derived block).
 */
export const SHARED_BLOCK_IDS = [
  'CLARIFICATION_PROTOCOL',
  'TASK_SPEC_CONTRACT',
  'REPLACEMENT_POLICY',
  'TOOLING_PRECEDENCE',
  'CLI_DELEGATION',
  'REVIEWER_STANCE',
] as const;

/** Literal union of every registered shared block id. */
export type SharedBlockId = (typeof SHARED_BLOCK_IDS)[number];

/**
 * Block ids whose content is GENERATED from constants rather than read from
 * `_shared/`. Mapped to their renderer so the resolver has one lookup, not a
 * special case in the middle of the replace loop.
 */
const DERIVED_BLOCKS: Readonly<Record<string, () => string>> = {
  TASK_SPEC_CONTRACT: renderTaskSpecAgentBlock,
};

/** `<id>` → `_shared/<id-in-kebab-case>.md`. */
export function partialFileName(id: string): string {
  return `${id.toLowerCase().replace(/_/g, '-')}.md`;
}

/**
 * Every STATIC marker line, open or close.
 *
 * The id is captured GREEDILY up to the comment terminator rather than as
 * `\w+`, so a malformed id reaches validation instead of making the whole line
 * fail to match — an unmatched marker line is exactly the invisible failure
 * this resolver was written to end.
 */
const MARKER_LINE = /^[ \t]*<!--[ \t]*(\/?)STATIC:(.*?)[ \t]*-->[ \t]*$/gm;

/** A marker id may contain upper-case letters and underscores. Nothing else. */
const VALID_BLOCK_ID = /^[A-Z_]+$/;

/** An unresolved `{{SLOT}}` placeholder. */
const SLOT = /\{\{([A-Za-z0-9_]+)\}\}/g;

interface MarkerMatch {
  readonly isClose: boolean;
  readonly id: string;
  /** Index of the first character of the marker line. */
  readonly start: number;
  /** Index one past the last character of the marker line. */
  readonly end: number;
}

/** One resolved shared block, for callers that want to assert on the parts. */
export interface ResolvedBlock {
  readonly id: SharedBlockId;
  readonly content: string;
}

/** Outcome of {@link TemplatePartialResolver.resolve}. */
export interface PartialResolution {
  /** The template body with every marker pair expanded and slots filled. */
  readonly content: string;
  /** Blocks expanded, in the order they appear. */
  readonly blocks: readonly ResolvedBlock[];
}

/**
 * Expands `<!-- STATIC:ID -->` pairs in a template body from `_shared/`.
 *
 * Injected into `TemplateStorageService` and called from
 * `loadTemplateFromDisk` immediately after `matter()`, so composition happens
 * ONCE, before generation. Everything downstream — the LLM content pass, the
 * `.claude/agents` writer, and every rival-CLI target `harness-sync` fans out
 * to — receives an already-expanded plain file.
 */
@injectable()
export class TemplatePartialResolver {
  /** `_shared/<file>` content, read once per process. */
  private readonly partialCache = new Map<string, string>();

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  /**
   * Expand every shared block in `content`.
   *
   * @param templateId - Template identifier, for error messages
   * @param content - Template body (frontmatter already stripped)
   * @param partialsDir - Absolute path to the `_shared` directory
   * @param variables - `{{SLOT}}` values from the template's frontmatter
   */
  async resolve(
    templateId: string,
    content: string,
    partialsDir: string,
    variables: Readonly<Record<string, string>> = {},
  ): Promise<Result<PartialResolution, Error>> {
    const markersResult = this.parseMarkers(templateId, content);
    if (markersResult.isErr()) {
      return Result.err(markersResult.error!);
    }
    const pairs = markersResult.value!;
    if (pairs.length === 0) {
      return Result.ok({ content, blocks: [] });
    }

    const blocks: ResolvedBlock[] = [];
    // Rebuild left to right so every recorded offset stays valid.
    let out = '';
    let cursor = 0;

    for (const { open, close } of pairs) {
      const bodyResult = await this.loadBlock(templateId, open.id, partialsDir);
      if (bodyResult.isErr()) {
        return Result.err(bodyResult.error!);
      }
      const filledResult = this.fillSlots(
        templateId,
        open.id,
        bodyResult.value!,
        variables,
      );
      if (filledResult.isErr()) {
        return Result.err(filledResult.error!);
      }
      const body = filledResult.value!;

      out += content.slice(cursor, open.end);
      out += `\n\n${body.trim()}\n\n`;
      cursor = close.start;
      blocks.push({ id: open.id as SharedBlockId, content: body.trim() });
    }
    out += content.slice(cursor);

    return Result.ok({ content: out, blocks });
  }

  /**
   * Find every marker, validate its id, and pair the opens with the closes.
   *
   * Nesting is rejected rather than supported: a nested shared block would mean
   * one canonical block's text depends on where it was included from, which is
   * the property this whole mechanism removes.
   */
  private parseMarkers(
    templateId: string,
    content: string,
  ): Result<Array<{ open: MarkerMatch; close: MarkerMatch }>, Error> {
    const markers: MarkerMatch[] = [];
    MARKER_LINE.lastIndex = 0;
    for (const match of content.matchAll(MARKER_LINE)) {
      const id = match[2];
      if (!VALID_BLOCK_ID.test(id)) {
        return Result.err(
          this.fail(
            templateId,
            `Malformed STATIC marker id ${JSON.stringify(id)} — ids must match /^[A-Z_]+$/`,
          ),
        );
      }
      if (!(SHARED_BLOCK_IDS as readonly string[]).includes(id)) {
        return Result.err(
          this.fail(
            templateId,
            `Unknown STATIC block id "${id}". Registered ids: ${SHARED_BLOCK_IDS.join(', ')}`,
          ),
        );
      }
      markers.push({
        isClose: match[1] === '/',
        id,
        start: match.index,
        end: match.index + match[0].length,
      });
    }

    const pairs: Array<{ open: MarkerMatch; close: MarkerMatch }> = [];
    let open: MarkerMatch | undefined;
    for (const marker of markers) {
      if (!marker.isClose) {
        if (open) {
          return Result.err(
            this.fail(
              templateId,
              `STATIC block "${open.id}" is still open where "${marker.id}" opens — blocks may not nest`,
            ),
          );
        }
        open = marker;
        continue;
      }
      if (!open) {
        return Result.err(
          this.fail(
            templateId,
            `Closing marker for STATIC block "${marker.id}" has no opening marker`,
          ),
        );
      }
      if (open.id !== marker.id) {
        return Result.err(
          this.fail(
            templateId,
            `STATIC block "${open.id}" is closed by "${marker.id}"`,
          ),
        );
      }
      pairs.push({ open, close: marker });
      open = undefined;
    }
    if (open) {
      return Result.err(
        this.fail(templateId, `STATIC block "${open.id}" is never closed`),
      );
    }

    return Result.ok(pairs);
  }

  /** Read a block's text, from its renderer or from `_shared/`. */
  private async loadBlock(
    templateId: string,
    id: string,
    partialsDir: string,
  ): Promise<Result<string, Error>> {
    const derive = DERIVED_BLOCKS[id];
    if (derive) {
      return Result.ok(derive());
    }

    const fileName = partialFileName(id);
    const cached = this.partialCache.get(fileName);
    if (cached !== undefined) {
      return Result.ok(cached);
    }

    const filePath = join(partialsDir, fileName);
    try {
      const text = await readFile(filePath, 'utf-8');
      this.partialCache.set(fileName, text);
      return Result.ok(text);
    } catch (error: unknown) {
      const reason =
        (error as NodeJS.ErrnoException)?.code === 'ENOENT'
          ? 'file not found'
          : error instanceof Error
            ? error.message
            : String(error);
      this.logger.error(
        `Shared partial unavailable for block ${id}`,
        error instanceof Error ? error : new Error(String(error)),
      );
      return Result.err(
        this.fail(
          templateId,
          `Cannot read shared partial for STATIC block "${id}" at ${filePath}: ${reason}`,
        ),
      );
    }
  }

  /**
   * Substitute `{{SLOT}}` placeholders from the frontmatter `variables` map.
   *
   * An undeclared slot fails the load. The alternative — leaving it in place —
   * ships a literal `{{CLARIFY_ARTIFACT}}` into the agent's own instructions,
   * where it reads as a real token the agent is expected to understand.
   *
   * Substitution is a SINGLE pass, and the result is then re-scanned. `replace`
   * never re-examines the text it just inserted, so a `variables` value that
   * itself contains `{{SOMETHING}}` used to survive into the output with
   * `missing` still empty — the exact leak this resolver exists to stop,
   * reaching the agent through the one path the check did not cover. The
   * re-scan is not a second substitution round on purpose: expanding a value
   * into another slot name is templating-in-templating, and refusing it is
   * cheaper to reason about than defining how deep it nests.
   */
  private fillSlots(
    templateId: string,
    id: string,
    body: string,
    variables: Readonly<Record<string, string>>,
  ): Result<string, Error> {
    const missing = new Set<string>();
    SLOT.lastIndex = 0;
    const filled = body.replace(SLOT, (whole, name: string) => {
      const value = variables[name];
      if (typeof value !== 'string') {
        missing.add(name);
        return whole;
      }
      return value;
    });

    if (missing.size > 0) {
      return Result.err(
        this.fail(
          templateId,
          `STATIC block "${id}" needs frontmatter variables not declared by this template: ${[
            ...missing,
          ].join(', ')}`,
        ),
      );
    }

    SLOT.lastIndex = 0;
    const residual = [...new Set([...filled.matchAll(SLOT)].map((m) => m[1]))];
    if (residual.length > 0) {
      return Result.err(
        this.fail(
          templateId,
          `STATIC block "${id}" still holds unresolved placeholder(s) after substitution: ${residual.join(
            ', ',
          )}. A frontmatter variable value that itself contains "{{...}}" is not expanded — inline the text instead.`,
        ),
      );
    }
    return Result.ok(filled);
  }

  private fail(templateId: string, message: string): TemplateError {
    return new TemplateError(
      message,
      templateId,
      'TEMPLATE_VALIDATION_ERROR',
      {},
    );
  }

  /** Drop cached partial files. Used by `TemplateStorageService.clearCache`. */
  clearCache(): void {
    this.partialCache.clear();
  }
}

/**
 * Post-generation gate for `<!-- LLM:ID -->` section text.
 *
 * ## Why this exists
 *
 * The `LLM:*` mechanism was removed from the templates once because of what the
 * old prompt PRODUCED, not because of the mechanism: lib counts, dependency
 * versions, coverage percentages and "as of <date>" clauses, all frozen at
 * wizard time into a file the user reads for months afterwards. A count is wrong
 * the first time someone adds a directory; a version is wrong the first time
 * someone runs an upgrade; and neither failure is visible, because the agent
 * file still reads as authoritative.
 *
 * A prompt alone cannot hold that line — a model asked for "conventions, not
 * counts" still writes "the 29 backend libs" when the analysis text in front of
 * it happens to say so. This class is the enforcement half. It reads only what
 * the model returned, and its answer is binary: keep the generated text, or keep
 * the authored fallback that sits between the markers.
 *
 * ## What it rejects, and why each rule is the shape it is
 *
 *  - **Version-like strings outside a path.** `21.3`, `v4.1.0`. Path tokens are
 *    masked out FIRST, so `rpc.types.ts` and `01-project-profile.md` are never
 *    read as versions.
 *  - **Numeric censuses.** A numeral followed by a plural noun — "15 libs",
 *    "22 tokens", "3 errors". Measurement nouns are exempt by name
 *    ({@link CENSUS_NEUTRAL_NOUNS}): "2 spaces" and "700 lines" are style rules
 *    that stay true, not inventories that go stale.
 *  - **Percentages and dates.** Both are timestamps wearing different clothes.
 *  - **Uncited or fabricated paths.** Every path the section names must be one
 *    the analysis surfaced OR one that exists on disk via
 *    {@link IFileSystemProvider}. The prompt lets the model open a file to
 *    confirm a convention, so a real file it opened and the analysis never
 *    listed is a legitimate citation; only a path neither the index nor the
 *    workspace knows is a fabrication.
 *  - **A dropped heading.** The fallback opens with its `## ` heading and the
 *    replacement must open with the same one, or the emitted agent file loses a
 *    section boundary that the template author put there.
 *
 * @module @ptah-extension/agent-generation/services
 */
import { injectable, inject } from 'tsyringe';
import {
  PLATFORM_TOKENS,
  type IFileSystemProvider,
} from '@ptah-extension/platform-core';

/** One LLM section handed to {@link GeneratedSectionValidator.validate}. */
export interface GeneratedSectionCandidate {
  /** Section id from the marker pair, e.g. `FRAMEWORK_CONVENTIONS`. */
  readonly sectionId: string;
  /** What the model returned for this section. */
  readonly generated: string;
  /** The authored text between the markers, kept when the candidate fails. */
  readonly fallback: string;
}

/** Root-relative paths the analysis surfaced, plus the root they hang off. */
export interface AnalysisPathIndex {
  /** Normalised, root-relative file AND directory paths. May be empty. */
  readonly paths: ReadonlySet<string>;
  /** Absolute workspace root, used to resolve a cited path for the disk check. */
  readonly rootPath: string;
}

/** Outcome for one section. */
export interface SectionVerdict {
  /** True when the generated text may replace the authored fallback. */
  readonly accepted: boolean;
  /** Human-readable reasons, empty when accepted. One per broken rule. */
  readonly violations: readonly string[];
}

/**
 * A numeral, then at most one qualifier, then a plural noun.
 *
 * The gap is capped at ONE word on purpose. At two it starts matching ordinary
 * prose — "run 2 of the affected tests" — and a validator that rejects correct
 * text teaches the next author to delete the validator.
 */
const CENSUS = /\b\d{1,7}\s+(?:[A-Za-z][\w-]*\s+)?([A-Za-z][\w-]*[sS])\b/;

/**
 * Plural nouns a numeral may legitimately precede.
 *
 * These are MEASUREMENTS — a property of a rule the repository states — not an
 * inventory of what the repository currently contains. "Indent with 2 spaces"
 * and "a soft ceiling of 700 lines" are as true next year as today, which is the
 * whole distinction this class enforces.
 */
const CENSUS_NEUTRAL_NOUNS: ReadonlySet<string> = new Set([
  'spaces',
  'tabs',
  'characters',
  'chars',
  'columns',
  'lines',
  'levels',
  'digits',
  'decimals',
  'bytes',
  'seconds',
  'minutes',
  'hours',
  'ms',
  'milliseconds',
  'arguments',
  'args',
  'parameters',
  'params',
]);

/** `1.2`, `4.1.0`, `v21.3` — a version once the path tokens are masked away. */
const VERSION_LIKE = /\bv?\d+\.\d+(?:\.\d+)*\b/;

/** `72%`, `72 %`, `72 percent`. */
const PERCENTAGE = /\d+(?:\.\d+)?\s*(?:%|percent\b)/i;

/** `2026-08-29`. */
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/;

/** A bare four-digit year. `ES2022` has no word boundary before the digits. */
const BARE_YEAR = /\b(?:19|20)\d{2}\b/;

/** `Aug 2026`, `August 29, 2026`. */
const MONTH_DATE =
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s*(?:19|20)?\d{2}\b/i;

/** Contents of a Markdown code span, where the prompt tells the model to cite. */
const CODE_SPAN = /`([^`\n]+)`/g;

/** The characters a path token may be built from. Whitespace ends the token. */
const PATH_CHARS = /^[@\w.\-*/\\]+$/;

/** A trailing `.ts`, `.json`, `.mjs` — one to eight alphanumerics after a dot. */
const HAS_EXTENSION = /\.[A-Za-z][A-Za-z0-9]{0,7}$/;

/**
 * Rejects LLM section text that states facts instead of conventions.
 *
 * Stateless and side-effect free apart from the optional disk probe, so a caller
 * may reuse one instance across every template in a wizard run.
 */
@injectable()
export class GeneratedSectionValidator {
  constructor(
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER, { isOptional: true })
    private readonly fileSystem: IFileSystemProvider | null = null,
  ) {}

  /**
   * Collect every path the model is allowed to cite.
   *
   * Sourced from the SAME text the prompt shows the model — the formatted
   * analysis summary or the multi-phase files — plus the structured context
   * fields. Anything else would let the validator reject a path the model was
   * handed, or accept one it invented.
   *
   * Each file also contributes its ancestor directories, so a section may cite
   * `libs/backend` when the analysis only listed files beneath it.
   *
   * @param rootPath - Absolute workspace root
   * @param sources - Free text and explicit path lists to mine
   */
  buildPathIndex(
    rootPath: string,
    sources: ReadonlyArray<string>,
  ): AnalysisPathIndex {
    const paths = new Set<string>();
    for (const source of sources) {
      if (!source) continue;
      for (const candidate of this.extractPathCandidates(source)) {
        const normalised = this.normalisePath(candidate, rootPath);
        if (!normalised) continue;
        paths.add(normalised.toLowerCase());
        const segments = normalised.split('/');
        for (let i = 1; i < segments.length; i++) {
          paths.add(segments.slice(0, i).join('/').toLowerCase());
        }
      }
    }
    return { paths, rootPath };
  }

  /**
   * Decide whether one generated section may replace its authored fallback.
   *
   * @param candidate - Section id, generated text and authored fallback
   * @param index - Paths the analysis surfaced, from {@link buildPathIndex}
   * @returns Accepted, or the list of rules the text broke
   */
  async validate(
    candidate: GeneratedSectionCandidate,
    index: AnalysisPathIndex,
  ): Promise<SectionVerdict> {
    const text = candidate.generated.trim();
    if (!text) {
      return { accepted: false, violations: ['returned empty text'] };
    }

    const violations: string[] = [];

    const headingProblem = this.checkHeading(text, candidate.fallback);
    if (headingProblem) violations.push(headingProblem);

    const cited = this.extractPathCandidates(text);
    const scrubbed = this.maskPaths(text, cited);

    const version = VERSION_LIKE.exec(scrubbed);
    if (version) {
      violations.push(
        `states a version number ("${version[0]}") — versions go stale the first time someone upgrades`,
      );
    }

    const percentage = PERCENTAGE.exec(scrubbed);
    if (percentage) {
      violations.push(
        `states a percentage ("${percentage[0].trim()}") — a measurement of today, not a convention`,
      );
    }

    const date =
      ISO_DATE.exec(scrubbed) ??
      MONTH_DATE.exec(scrubbed) ??
      BARE_YEAR.exec(scrubbed);
    if (date) {
      violations.push(
        `states a date ("${date[0].trim()}") — the file carries no "as of" clause a reader can trust`,
      );
    }

    const census = CENSUS.exec(scrubbed);
    if (census && !CENSUS_NEUTRAL_NOUNS.has(census[1].toLowerCase())) {
      violations.push(
        `counts repository contents ("${census[0].trim()}") — wrong the first time anyone adds one`,
      );
    }

    violations.push(...(await this.checkCitedPaths(cited, index)));

    return { accepted: violations.length === 0, violations };
  }

  /**
   * The fallback's `## ` heading is the section boundary the template author
   * drew. Generated text that drops or renames it silently restructures the
   * emitted agent file, because the markers are gone by the time anyone reads it.
   */
  private checkHeading(text: string, fallback: string): string | null {
    const wanted = this.firstHeading(fallback);
    if (!wanted) return null;
    const got = this.firstHeading(text);
    if (got === wanted) return null;
    return got
      ? `renamed the section heading to "${got}" (template declares "${wanted}")`
      : `dropped the section heading "${wanted}"`;
  }

  /** First non-empty line, normalised, when it is an H2. */
  private firstHeading(text: string): string | null {
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const match = /^##\s+(.+?)\s*$/.exec(line);
      return match ? match[1].replace(/\s+/g, ' ').toLowerCase() : null;
    }
    return null;
  }

  /**
   * Every cited path must be one the analysis surfaced, or one that is really
   * there.
   *
   * The two checks are applied PER PATH, not one instead of the other. The
   * prompt tells the model it may open a file to confirm a convention and may
   * cite what it opened, so a path the analysis never listed is not evidence of
   * invention — the index is a summary of the repository, never the whole of it.
   * Gating the disk probe on an empty index made the common case the broken one:
   * the model checked, cited honestly, and the fallback shipped anyway.
   *
   * A path is a fabrication only when the index does not hold it AND the
   * workspace does not contain it. When there is no file-system port either,
   * path checking stands down rather than failing every section on a capability
   * the host does not have.
   */
  private async checkCitedPaths(
    cited: readonly string[],
    index: AnalysisPathIndex,
  ): Promise<string[]> {
    const canCheckBySet = index.paths.size > 0;
    const canCheckByDisk = this.fileSystem !== null;
    if (!canCheckBySet && !canCheckByDisk) return [];

    if (cited.length === 0) {
      return [
        'cites no path from the analysis — every claim must point at something in this repository',
      ];
    }

    const unknown: string[] = [];
    for (const raw of cited) {
      const normalised = this.normalisePath(raw, index.rootPath);
      if (!normalised) continue;
      if (canCheckBySet && this.isKnownPath(normalised, index.paths)) continue;
      if (canCheckByDisk && (await this.existsOnDisk(raw, index.rootPath))) {
        continue;
      }
      unknown.push(raw);
    }

    if (unknown.length === 0) return [];
    const named = [...new Set(unknown)].join(', ');
    return [
      canCheckByDisk
        ? `cites path(s) that neither the analysis surfaced nor the workspace contains: ${named}`
        : `cites path(s) the analysis never surfaced: ${named}`,
    ];
  }

  /**
   * A cited path matches when it IS a known path, is an ancestor of one, or is a
   * glob whose fixed prefix is. `libs/backend/**\/*.ts` is a legitimate way to
   * name a directory's contents and rejecting it would push the model back to
   * prose with no citation at all.
   */
  private isKnownPath(normalised: string, known: ReadonlySet<string>): boolean {
    const lower = normalised.toLowerCase();
    if (known.has(lower)) return true;

    const star = lower.indexOf('*');
    if (star >= 0) {
      const prefix = lower.slice(0, star).replace(/\/+$/, '');
      return prefix.length > 0 && known.has(prefix);
    }

    for (const entry of known) {
      if (entry.startsWith(`${lower}/`)) return true;
    }
    return false;
  }

  /**
   * Resolve inside the root and ask the platform port. Never throws.
   *
   * Takes the RAW citation, not the normalised form, because normalisation
   * strips a leading slash and would turn `/etc/passwd` into a root-relative
   * probe. {@link resolveInsideRoot} is what decides the string is safe to hand
   * to the port at all.
   */
  private async existsOnDisk(raw: string, rootPath: string): Promise<boolean> {
    if (!this.fileSystem) return false;
    const relative = this.resolveInsideRoot(raw.split('*')[0], rootPath);
    if (!relative) return false;
    const root = rootPath.replace(/\\/g, '/').replace(/\/+$/, '');
    try {
      return await this.fileSystem.exists(`${root}/${relative}`);
    } catch {
      return false;
    }
  }

  /**
   * Root-relative form of a citation, or `null` when it points outside the root.
   *
   * The disk check turns model-authored text into a file-system probe, so the
   * citation decides the path. `../../.ssh/id_rsa` must not become a probe, and
   * an absolute path that is not under the root is not a citation of THIS
   * repository — both are answered with `null` rather than a lookup. Interior
   * `..` that stays within the root resolves normally; it is a legal way to
   * write a path, not an escape.
   */
  private resolveInsideRoot(raw: string, rootPath: string): string | null {
    const root = rootPath.replace(/\\/g, '/').replace(/\/+$/, '');
    let rest = raw.trim().replace(/\\/g, '/');
    if (root && rest.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
      rest = rest.slice(root.length + 1);
    } else if (/^\//.test(rest) || /^[A-Za-z]:\//.test(rest)) {
      return null;
    }

    const segments: string[] = [];
    for (const segment of rest.split('/')) {
      if (!segment || segment === '.') continue;
      if (segment === '..') {
        if (segments.length === 0) return null;
        segments.pop();
        continue;
      }
      segments.push(segment);
    }
    return segments.length > 0 ? segments.join('/') : null;
  }

  /**
   * Replace every cited path with a space before the numeric rules run.
   *
   * Without this, `rpc.types.ts` reads as a version and `01-project-profile.md`
   * reads as a census — the two rules would fire on exactly the citations the
   * prompt asks for.
   */
  private maskPaths(text: string, cited: readonly string[]): string {
    let out = text;
    for (const path of [...cited].sort((a, b) => b.length - a.length)) {
      out = out.split(path).join(' ');
    }
    return out;
  }

  /**
   * Pull path-like tokens out of free text.
   *
   * Two sources, held to different standards.
   *
   * A Markdown code span is where the prompt TELLS the model to put a citation,
   * so two segments are enough there — `libs/core` in backticks is a directory
   * reference and nothing else. Bare prose needs harder evidence: an extension,
   * a glob, or three or more segments, so `and/or` stays prose.
   *
   * Under-detection is the safe direction in prose and over-detection is the
   * safe direction in a code span: a missed token is a citation nobody checked,
   * while a false positive costs one section its generated text.
   */
  private extractPathCandidates(text: string): string[] {
    const found: string[] = [];
    const consider = (token: string, strict: boolean): void => {
      const trimmed = this.trimDelimiters(token);
      if (this.looksLikePath(trimmed, strict)) found.push(trimmed);
    };

    CODE_SPAN.lastIndex = 0;
    for (const match of text.matchAll(CODE_SPAN)) {
      consider(match[1], false);
    }
    for (const token of text.split(/\s+/)) {
      consider(token, true);
    }
    return [...new Set(found)];
  }

  /** Strip the punctuation Markdown prose wraps a path in. */
  private trimDelimiters(token: string): string {
    return token
      .trim()
      .replace(/^[`"'([<{]+/, '')
      .replace(/[`"')\]>},.;:!?]+$/, '');
  }

  private looksLikePath(token: string, strict: boolean): boolean {
    if (!token || token.includes('://')) return false;
    if (!PATH_CHARS.test(token)) return false;

    const unified = token.replace(/\\/g, '/');
    const segments = unified.split('/').filter(Boolean);
    if (segments.length === 0) return false;

    if (segments.length === 1) {
      // A bare filename counts only with an extension — `package.json` is a
      // citation, `OnPush` is an identifier.
      return HAS_EXTENSION.test(segments[0]) && unified.includes('.');
    }
    if (unified.includes('*')) return true;
    if (segments.some((segment) => HAS_EXTENSION.test(segment))) return true;
    return strict ? segments.length >= 3 : true;
  }

  /** Root-relative, forward-slashed, no leading `./` and no trailing slash. */
  private normalisePath(raw: string, rootPath: string): string {
    let out = raw.trim().replace(/\\/g, '/');
    const root = rootPath.replace(/\\/g, '/').replace(/\/+$/, '');
    if (root && out.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
      out = out.slice(root.length + 1);
    }
    return out.replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '');
  }
}

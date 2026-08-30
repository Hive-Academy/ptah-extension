/**
 * The approved wording for every surface that tells a user how to clear a
 * blocked harness path — an exact-match ALLOWLIST, not a verb denylist.
 *
 * ### The rule this protects
 *
 * A blocked path is a desired path an unowned file occupies. Nothing proves
 * Ptah wrote that file — `SkillJunctionService` LINKED skills and only COPIED
 * commands, the Claude Code SDK and the pre-TASK_2026_288 `npx skills add`
 * path both wrote straight into `.claude/skills`, and so did the user's own
 * hand — so **every surface must say MOVE and must never advise destroying the
 * occupant.** Move is reversible. The alternative is not, and the occupant may
 * be the user's only copy of their own work. See the harness-sync CLAUDE.md
 * section "The 13 are of UNKNOWN provenance".
 *
 * ### Why an allowlist, and why the brittleness is the point
 *
 * The guard used to be eight regexes over the whole line
 * (`\bdelete[ds]?\b`, `\bremove[ds]?\b`, `\berase[ds]?\b`, `\btrash\b`,
 * `\brm\b`, …). A denylist can only ban the phrasings somebody thought of, and
 * "purge", "wipe", "drop", "nuke", "clear out", "get rid of", "blow away",
 * "scrub" and "send it to the recycle bin" all passed it — each of which reads
 * to a user as exactly the instruction the rule forbids. Worse, three of the
 * five surfaces never got even that list: they made a bare
 * `not.toContain('delete')` check, so "remove the occupant" would have shipped
 * on the Dashboard card, the Marketplace popover and the health store today.
 *
 * So the check is inverted. A surface passes only by rendering a sentence that
 * is ALREADY on this list, character for character. That makes any rewording
 * — benign or not — go red, which is correct for a safety-critical
 * instruction: the new wording should be re-approved by a human reading this
 * file, not merely re-scanned by a regex it happens to slip past.
 *
 * ### How a new phrasing gets approved
 *
 * Add or edit the literal here, in the same commit as the surface that renders
 * it. There is no other door: {@link harnessBlockedWordingViolations} compares
 * with `===`, and the surface specs compare the rendered text against these
 * constants. A production string edited alone fails its surface spec; a
 * constant edited alone fails it too, because the two must agree.
 *
 * ### Why the allowlist lives in `libs/shared`
 *
 * Five surfaces, two sides of the hexagon. `harness-sync` (backend) emits the
 * reconcile WARN; `marketplace` and `dashboard` (frontend) render the other
 * four. A frontend lib may not import a backend lib, and five private copies of
 * the approved sentence is precisely how the wording drifted apart in the first
 * place. `libs/shared` is the one permitted bridge, and it already holds
 * `blockedTargetPaths()` and `summarizeHarnessHealth()` for this exact reason:
 * more than one consumer reads it and they must never disagree.
 *
 * ### The scope is the WHOLE surface, not just the action clause
 *
 * TASK_2026_306 Batch 12 inserted a sentence into the MIDDLE of the reconcile
 * WARN's paragraph. An action-only check would have missed a destructive verb
 * placed in `note`, in a per-path `reason`, in a button label or in an outcome
 * line. So every fixed sentence each surface may render is listed here too, and
 * the checker requires the residue — whatever is left after the approved
 * sentences and the caller's declared DATA are struck out — to contain no
 * prose at all.
 */

/** The five surfaces that tell a user how to clear a blocked harness path. */
export type HarnessBlockedSurface =
  | 'reconcile-warn'
  | 'marketplace-popover'
  | 'dashboard-card'
  | 'repair-dialog'
  | 'health-store';

/**
 * The fixed head of the "clear it yourself" sentence.
 *
 * It opens on MOVE deliberately, and the first clause names both shapes a
 * blocked path takes — a file or directory, or a server key inside a config
 * file the user also writes — because "move the occupant" is meaningless
 * advice for the second.
 */
const CLEAR_IT_YOURSELF_OPENING =
  'Move the occupant aside — the file or directory at each path, or the ' +
  'conflicting key in each config file — ';

/**
 * The fixed tail. It hands the judgement back: Ptah states that it cannot
 * prove ownership and then stops short of telling the user what to do with
 * their own file.
 */
const CLEAR_IT_YOURSELF_CLOSING =
  ' Nothing here proves Ptah wrote these, so they may be your own work: keep ' +
  'what you move, and read it before you discard anything.';

/**
 * The one clause that may differ between surfaces: where the user can act.
 *
 * Everything around it is fixed. This varies because it points at a control
 * and the control is not in the same place on every surface — the Reconcile
 * button sits eight pixels below the popover's paragraph, the Dashboard card
 * has its own dialog, and the log line has neither and must name both routes.
 *
 * Adding a sixth surface means adding a key here. Rewording an existing one
 * means editing its value here, which is the deliberate, reviewable act this
 * module exists to force.
 */
export const HARNESS_BLOCKED_RECONCILE_STEPS = {
  'reconcile-warn':
    'then re-run `ptah harness doctor --fix`. The same list is on the ' +
    'Dashboard home, in the "Your harness is short" card.',
  'marketplace-popover': 'then run Reconcile now.',
  'dashboard-card':
    'then reconcile from Marketplace → Plugins, or let Ptah move it for you ' +
    'with the button below.',
} as const satisfies Readonly<Record<string, string>>;

/** A surface whose action is the shared "clear it yourself" sentence. */
export type HarnessBlockedReconcileSurface =
  keyof typeof HARNESS_BLOCKED_RECONCILE_STEPS;

/** The approved middle clauses, as a type — an unlisted phrasing will not compile. */
export type HarnessBlockedReconcileStep =
  (typeof HARNESS_BLOCKED_RECONCILE_STEPS)[HarnessBlockedReconcileSurface];

/**
 * Assemble the approved "clear it yourself" sentence for one surface.
 *
 * Exported so a surface can render it rather than restate it, and so a reader
 * can see that the three phrasings differ in exactly one clause.
 */
export function harnessBlockedAction(
  surface: HarnessBlockedReconcileSurface,
): string {
  return `${CLEAR_IT_YOURSELF_OPENING}${HARNESS_BLOCKED_RECONCILE_STEPS[surface]}${CLEAR_IT_YOURSELF_CLOSING}`;
}

/**
 * The quarantine folder the consent-gated repair moves an occupant into.
 * Mirrors `QUARANTINE_DIR_NAME` in `harness-sync/src/lib/quarantine`.
 */
export const HARNESS_QUARANTINE_DIR_NAME = '.ptah-quarantine';

/**
 * The worked example the repair dialog shows before consent is given.
 *
 * A rule plus one instance of it, not a single absolute path: the quarantine is
 * a SIBLING of the occupant, so a blocked `.codex/prompts/x` and a blocked
 * `.claude/skills/y` land in two different folders.
 */
export const HARNESS_QUARANTINE_EXAMPLE = {
  from: '.claude/skills/orchestration',
  to: '.claude/skills/.ptah-quarantine/orchestration-20260823T141530123',
} as const;

/**
 * The repair dialog's action sentence.
 *
 * A different shape from the other three, because it describes Ptah performing
 * the move rather than the user doing it by hand — but the same four
 * properties: it opens on MOVE, it names the destination and says the
 * destination is permanent, it claims no ownership, and it closes by handing
 * the judgement back.
 */
const REPAIR_DIALOG_ACTION =
  'Move the occupant aside and Ptah installs its own copy in the space it ' +
  `leaves. Everything you tick is moved into a ${HARNESS_QUARANTINE_DIR_NAME} folder ` +
  `beside it — so ${HARNESS_QUARANTINE_EXAMPLE.from} becomes ` +
  `${HARNESS_QUARANTINE_EXAMPLE.to} — ` +
  'intact, under its own name and the time it was moved. Ptah never empties ' +
  'that folder and nothing in it expires: what goes there stays until you ' +
  'deal with it yourself. Nothing here proves Ptah wrote these, so they may ' +
  'be your own work: read it before you discard anything.';

/**
 * The per-path `reason` strings the repair emits — Ptah-authored SENTENCES,
 * not user data, and the sixth surface.
 *
 * `HarnessRepairPathResult.reason` renders unconditionally in the repair
 * dialog (`harness-repair-dialog.component.ts:276-280`), so every value
 * `HarnessBlockedRepairService` puts in that field is prose a user reads while
 * deciding what to do with their own files. It was invisible to the first
 * version of this guard because no spec ever rendered a REAL one: the only
 * value any test exercised was an invented fixture, always declared as `data`,
 * and `data` is struck before the residue is judged. A destructive rewrite of
 * any literal below shipped green.
 *
 * Two are TEMPLATES, so only the fixed head is approved here — what follows is
 * an OS error string or a quarantine path, which is data. Truncating at the
 * interpolation is deliberate: approving `${describeError(error)}` would be
 * approving whatever the filesystem says.
 */
export const HARNESS_REPAIR_REASONS = {
  /** `move-failed`. Continues with `describeError(error)`. */
  moveFailed: 'could not move the occupant aside, so nothing was written here:',
  /** `restored`. Fixed. */
  restored:
    'the managed copy could not be written, so your original was put back and the path is blocked again',
  /** `restore-failed`. Continues with the quarantine path and `describeError(error)`. */
  restoreFailed:
    'the managed copy was not written and your original could not be put back — it is at',
  /** `not-a-path`. Fixed. */
  notAPath:
    'this is a server key inside a config file you also write, not a file — there is nothing to move aside',
  /** `not-blocked`. Fixed. */
  notBlocked:
    'this path is not in the current blocked set, so it was left untouched',
} as const satisfies Readonly<Record<string, string>>;

/**
 * Ptah-authored text that reaches the same `reason` field INDIRECTLY, through
 * `describeError(error)` on a `quarantine.ts` assertion.
 *
 * These only appear when the filesystem lies or the quarantine names are
 * exhausted, which is rare — and rare is exactly the wording nobody reviews.
 * Listed as fragments rather than sentences because each is split around an
 * interpolated path.
 */
export const HARNESS_QUARANTINE_FAILURE_PROSE: readonly string[] =
  Object.freeze([
    'the move reported success but',
    'is still in place',
    'does not exist',
    'quarantine destination is exhausted for',
  ]);

/**
 * What the health store says when `harness:repairBlocked` fails with no
 * message of its own.
 *
 * It is on this list because it is the fifth surface: the only sentence the
 * store composes about blocked paths, shown to a user who has just consented
 * to a move. "Failed to delete the blocked paths" would misdescribe the
 * operation AND teach the wrong verb for it, which is why a store fallback
 * belongs under the same guard as a paragraph of prose.
 */
const HEALTH_STORE_REPAIR_FAILURE = 'Failed to move the blocked paths aside';

/**
 * THE ALLOWLIST. The exact action string each surface is approved to say.
 *
 * `===` against these is the whole guard. Nothing is matched by pattern, so
 * there is no synonym to enumerate and no phrasing to slip past.
 */
export const HARNESS_BLOCKED_APPROVED_ACTIONS: Readonly<
  Record<HarnessBlockedSurface, string>
> = Object.freeze({
  'reconcile-warn': harnessBlockedAction('reconcile-warn'),
  'marketplace-popover': harnessBlockedAction('marketplace-popover'),
  'dashboard-card': harnessBlockedAction('dashboard-card'),
  'repair-dialog': REPAIR_DIALOG_ACTION,
  'health-store': HEALTH_STORE_REPAIR_FAILURE,
});

/** The reconcile WARN's message line. Prose, so it is in scope. */
export const HARNESS_BLOCKED_WARN_MESSAGE =
  '[harness-sync] Blocked: desired paths an unowned file occupies — refused, not failed';

/** The reconcile WARN's `note` field — Batch 12's mid-paragraph insertion. */
export const HARNESS_BLOCKED_WARN_NOTE =
  'Counted in `missing` because the artifact is not installed, and in ' +
  '`foreign` because Ptah will not touch a file it cannot prove it wrote. A ' +
  'blocked path never enters the write plan, so `writeFailed` can never ' +
  'report one.';

/** The two per-path `reason` strings the WARN may carry. */
export const HARNESS_BLOCKED_WARN_REASONS = {
  occupiedPath: 'occupied by a file or directory Ptah does not own',
  occupiedMcpKey:
    'the config file already defines this server key, and Ptah did not write it',
} as const satisfies Readonly<Record<string, string>>;

/**
 * Every fixed sentence each surface is approved to render, action included.
 *
 * This is what makes the guard whole-surface rather than action-only. The
 * checker strikes these out and then refuses any prose left standing, so a
 * destructive verb smuggled into a button label, an outcome line, a `note` or
 * a per-path `reason` fails just as loudly as one in the action itself.
 *
 * Entries that interpolate a count are listed from the first word after the
 * number, because the number is data and the sentence is not.
 */
export const HARNESS_BLOCKED_APPROVED_PROSE: Readonly<
  Record<HarnessBlockedSurface, readonly string[]>
> = Object.freeze({
  'reconcile-warn': Object.freeze([
    HARNESS_BLOCKED_APPROVED_ACTIONS['reconcile-warn'],
    HARNESS_BLOCKED_WARN_MESSAGE,
    HARNESS_BLOCKED_WARN_NOTE,
    HARNESS_BLOCKED_WARN_REASONS.occupiedPath,
    HARNESS_BLOCKED_WARN_REASONS.occupiedMcpKey,
  ]),
  'marketplace-popover': Object.freeze([
    HARNESS_BLOCKED_APPROVED_ACTIONS['marketplace-popover'],
    'Something Ptah does not own already sits there. Each one counts as ' +
      'missing because the artifact is not installed, and Ptah left it alone ' +
      'because it cannot prove it wrote what is already there. A path it ' +
      'refuses is never attempted, so a block never shows up as a write ' +
      'failure — that is how the harness reads short with nothing having failed.',
    'blocked path',
    'blocked paths',
  ]),
  'dashboard-card': Object.freeze([
    HARNESS_BLOCKED_APPROVED_ACTIONS['dashboard-card'],
    'Something Ptah does not own already sits there. Each one counts as ' +
      'missing because the artifact is not installed, and Ptah left it alone ' +
      'because it cannot prove it wrote what is already there. A path it ' +
      'refuses is never attempted, so a block never shows up as a write ' +
      'failure — that is how the harness reads short with nothing having failed.',
    'Your harness is short',
    'Some of what Ptah tried to install for your AI tools is not there, and ' +
      'nothing failed while installing it.',
    'Move these aside…',
    'blocked path',
    'blocked paths',
  ]),
  'repair-dialog': Object.freeze([
    HARNESS_BLOCKED_APPROVED_ACTIONS['repair-dialog'],
    'Move blocked paths aside',
    'paths are occupied by something Ptah does not own. Tick only the ones ' +
      'you are sure it should take over.',
    'path is occupied by something Ptah does not own. Tick only the ones you ' +
      'are sure it should take over.',
    'Ptah cannot prove it created these directories. It has no record of ' +
      'writing them, and the things that could have — your AI tool, an older ' +
      'installer, or you — are indistinguishable from here. So nothing is ' +
      'ticked for you, and Ptah touches only what you tick.',
    'Nothing is blocked any more. There is nothing here to move.',
    'Select all',
    'Clear selection',
    'Your content is at',
    "Moved aside. Ptah's copy is installed at the path.",
    'Moved aside, but Ptah did not install its copy, so your content was put ' +
      'back where it was. Still blocked.',
    'Could not be moved. Your content is untouched and nothing was written ' +
      'at this path.',
    'Moved aside, Ptah did not install its copy, and your content could not ' +
      'be put back. It is in the quarantine folder named below and nowhere else.',
    'No longer blocked, so Ptah refused it and left it untouched.',
    'A server key inside a config file you also write, not a file. There is ' +
      'nothing to move aside, so this one does not apply.',
    'Move aside and install',
    'aside and install',
    'Moving…',
    'Cancel',
    'Close',
    'selected',
    // The sixth surface: `HarnessRepairPathResult.reason`, rendered at
    // `harness-repair-dialog.component.ts:276-280`. Ptah's sentences, so they
    // are approved PROSE here and must never be passed as `data`.
    ...Object.values(HARNESS_REPAIR_REASONS),
    ...HARNESS_QUARANTINE_FAILURE_PROSE,
  ]),
  'health-store': Object.freeze([
    HARNESS_BLOCKED_APPROVED_ACTIONS['health-store'],
  ]),
});

/** One surface's rendered output, handed to the checker. */
export interface HarnessBlockedWordingCheck {
  /** Which of the five is being checked. */
  readonly surface: HarnessBlockedSurface;
  /**
   * The action string the surface actually produced — the WARN's `action`
   * field, or the text of the surface's action paragraph.
   */
  readonly action: string;
  /**
   * The WHOLE line or the WHOLE rendered surface, so a destructive verb placed
   * anywhere else fails too. Whitespace runs may be collapsed by the caller;
   * the checker collapses them again either way.
   */
  readonly wholeText: string;
  /**
   * Text that is DATA rather than Ptah's wording — paths, target labels, and
   * any per-path reason the caller injected as a fixture. Struck out before
   * the residue is judged, because a user's own filename is not a wording
   * decision anybody has to approve.
   */
  readonly data?: readonly string[];
}

/** Collapse whitespace and case so template line-wrapping cannot change a verdict. */
function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * A run of four or more plain words — the shortest thing that can carry an
 * instruction ("purge the occupant first" is four).
 *
 * Deliberately does not cross digits, punctuation or the struck-out sentinel,
 * so a heading like "13 blocked paths", a target label like "Claude Code" and a
 * path like `.claude/skills/a` are not prose and never need approving.
 */
const PROSE_RUN = /[a-z][a-z'’]*(?: [a-z][a-z'’]*){3,}/g;

/**
 * The BACKSTOP, and yes it is a denylist. That is deliberate, and it is not a
 * reintroduction of the denylist this module replaced.
 *
 * A denylist is only dangerous as a PRIMARY mechanism, because there its
 * silence means "approved" — and a denylist can only ever be silent about the
 * phrasings somebody thought of, which is how "purge", "wipe" and "remove the
 * occupant" all passed the eight regexes this file replaced. Underneath an
 * authoritative allowlist the polarity is inverted: approval comes from
 * {@link HARNESS_BLOCKED_APPROVED_ACTIONS} and
 * {@link HARNESS_BLOCKED_APPROVED_PROSE} and from nowhere else, so this list
 * can only ever ADD a failure and can never grant permission. Being incomplete
 * therefore costs nothing it was relied on for.
 *
 * What it buys is the case {@link PROSE_RUN} structurally cannot see. That
 * threshold is four words, because a target label ("Claude Code") and a
 * heading ("13 blocked paths") are not prose and must not be approved one by
 * one — but it means "Delete these" on a button, or "Purge it", is two words
 * and invisible. This fires on those regardless of length.
 */
const DESTRUCTIVE_VERB =
  /\b(?:delete[sd]?|deleting|deletion|remove[sd]?|removing|removal|erase[sd]?|erasing|trash(?:ed|es|ing)?|purge[sd]?|purging|wipe[sd]?|wiping|nuke[sd]?|nuking|destroy(?:s|ed|ing)?|obliterate[sd]?|discard(?:s|ed|ing)?|drop(?:s|ped|ping)?|scrub(?:s|bed|bing)?|unlink(?:s|ed|ing)?)\b|get rid of|clear out|blow(?:n|s)? away|throw(?:n|s)? away|recycle bin/i;

/**
 * The one place the user's own judgement is invoked rather than instructed.
 *
 * "read it before you discard anything" is the sanctioned use of a word that
 * is otherwise on the backstop list, and it is sanctioned because it is
 * addressed TO the user ABOUT their own file — the opposite of Ptah telling
 * them to destroy it. Named here so the self-check below can exempt exactly
 * this phrase and nothing else.
 */
export const HARNESS_BLOCKED_SANCTIONED_PHRASE =
  'read it before you discard anything';

/**
 * Does this text present destroying something as the action?
 *
 * Exported so the backstop is testable on its own and so the allowlist can be
 * checked against itself — an approved sentence that carries a destructive
 * verb would let a rewording through by being approved, which is the one path
 * the two-sided pin cannot close on its own.
 */
export function containsDestructiveVerb(text: string): boolean {
  return DESTRUCTIVE_VERB.test(
    text.split(HARNESS_BLOCKED_SANCTIONED_PHRASE).join(' '),
  );
}

/** Replacement for a struck-out fragment: not a letter, so it breaks any run. */
const STRUCK = ' ~ ';

function strikeOut(haystack: string, fragment: string): string {
  const needle = normalize(fragment).toLowerCase();
  if (needle.length === 0) return haystack;
  let out = haystack;
  for (
    let at = out.indexOf(needle);
    at !== -1;
    at = out.indexOf(needle, at + STRUCK.length)
  ) {
    out = out.slice(0, at) + STRUCK + out.slice(at + needle.length);
  }
  return out;
}

/**
 * Check one surface against the allowlist. Returns every violation, so a
 * failing spec prints WHAT broke rather than only that something did.
 *
 * Four rules, and only the first is action-only:
 *
 * 1. The action must be on {@link HARNESS_BLOCKED_APPROVED_ACTIONS}, exactly.
 * 2. After the surface's approved sentences and the caller's declared data are
 *    struck out of the whole text, no prose may be left standing.
 * 3. Nor may a destructive verb, at ANY length — see {@link DESTRUCTIVE_VERB}
 *    for why a denylist is sound in that position and only in that position.
 * 4. `data` may not be used to launder wording. An entry that both reads as
 *    prose and carries a destructive verb is rejected rather than struck.
 *
 * @returns an empty array when the surface is compliant.
 */
export function harnessBlockedWordingViolations(
  check: HarnessBlockedWordingCheck,
): readonly string[] {
  const violations: string[] = [];
  const approved = HARNESS_BLOCKED_APPROVED_ACTIONS[check.surface];
  const action = normalize(check.action);

  if (action !== normalize(approved)) {
    violations.push(
      `[${check.surface}] action is not the approved sentence.\n` +
        `  approved: ${approved}\n` +
        `  rendered: ${action}\n` +
        '  Every surface must say MOVE and must never advise destroying the ' +
        'occupant, because nothing proves Ptah wrote it. If this rewording is ' +
        'intended, approve it in libs/shared/src/lib/types/harness-blocked-wording.ts.',
    );
  }

  const whole = normalize(check.wholeText).toLowerCase();
  if (!whole.includes(action.toLowerCase())) {
    violations.push(
      `[${check.surface}] the whole text does not contain the action it reported.`,
    );
  }

  // `data` is an escape hatch for text that is genuinely the user's — a
  // filename, a target label, an OS error string. It is struck unconditionally,
  // which is precisely why it must not become the door round the allowlist:
  // `HarnessRepairPathResult.reason` carries Ptah's own sentences in five
  // cases and caller-supplied text in others, and declaring the whole field
  // data is what hid it from this guard in the first place.
  for (const declared of check.data ?? []) {
    const value = normalize(declared).toLowerCase();
    if (DESTRUCTIVE_VERB.test(value) && (value.match(PROSE_RUN) ?? []).length) {
      violations.push(
        `[${check.surface}] "${normalize(declared)}" was passed as \`data\` but reads as an ` +
          'instruction, not as a path or a label.\n' +
          '  Ptah wording goes on the allowlist where it can be reviewed. If ' +
          'this really is text Ptah did not author, it still may not be ' +
          'presented to a user as the remedy for a blocked path.',
      );
    }
  }

  // Longest first, so a short fragment cannot bite a hole in a long sentence
  // and leave its remainder looking like unapproved prose.
  const fragments = [
    ...HARNESS_BLOCKED_APPROVED_PROSE[check.surface],
    ...(check.data ?? []),
    action,
  ].sort((a, b) => b.length - a.length);

  let residue = whole;
  for (const fragment of fragments) {
    residue = strikeOut(residue, fragment);
  }

  const leftovers = residue.match(PROSE_RUN) ?? [];
  for (const leftover of leftovers) {
    violations.push(
      `[${check.surface}] unapproved prose: "${leftover.trim()}".\n` +
        '  Every sentence a blocked-path surface renders is allowlisted. Add ' +
        'it to HARNESS_BLOCKED_APPROVED_PROSE if it is wording, or pass it as ' +
        '`data` if it is a path, a label or a fixture value.',
    );
  }

  // The length-independent backstop. Runs on the same residue, so it can only
  // fire on text the allowlist did not already approve — see DESTRUCTIVE_VERB.
  // "Delete these" on a button is two words: rule 2 above cannot see it.
  const destructive = DESTRUCTIVE_VERB.exec(residue);
  if (destructive !== null) {
    violations.push(
      `[${check.surface}] unapproved destructive verb: "${destructive[0]}".\n` +
        `  In: "${contextAround(residue, destructive.index).trim()}"\n` +
        '  Nothing proves Ptah wrote a blocked path, so no surface may present ' +
        'destroying the occupant as the remedy. Move is reversible; this is not.',
    );
  }

  return violations;
}

/**
 * A short window round a match, so the failure names where it is. Runs of
 * struck-out approved sentences collapse to a single `…` rather than filling
 * the message with sentinels.
 */
function contextAround(text: string, at: number): string {
  return text
    .slice(Math.max(0, at - 40), at + 60)
    .replace(/(?: ?~ ?)+/g, ' … ')
    .replace(/\s+/g, ' ')
    .trim();
}

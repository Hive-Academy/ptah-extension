/**
 * CandidateNamerService specs — P1-10 part (a).
 *
 * P1-10 as originally written ("the display name is not the first user
 * message") was an unbounded negative and therefore unassertable. Restated as
 * the two bounded claims below:
 *
 *   1. Given a 400-character first user message, the produced `display_name`
 *      is NOT `trajectory.slug` and is at most 60 characters.
 *   2. When the naming lane is unavailable, `display_name` stays NULL — the
 *      store is not written at all.
 *
 * The slug keeps its job as an internal id throughout; nothing here renames it.
 */
import 'reflect-metadata';
import {
  CANDIDATE_DISPLAY_NAME_MAX_CHARS,
  CANDIDATE_NAMING_JSON_SCHEMA,
  CandidateNamerService,
  type CandidateNamingSource,
} from './candidate-namer.service';
import { LaneRunnerService } from '../lanes/lane-runner.service';
import {
  assistantText,
  makeBudgetStub,
  makeLogger,
  makeQueryStub,
  makeResolverStub,
  makeThrowingResolverStub,
  resolvedLane,
  resultMessage,
  type StreamMessage,
} from '../lanes/lane-runner.test-support';
import type { SkillCandidateStore } from '../skill-candidate.store';
import type { CandidateId } from '../types';

const CANDIDATE_ID = 'cand_name' as CandidateId;

/**
 * A 400-character opening message. The extractor slugifies only its first 140
 * characters, so this is the exact shape that produced the unreadable titles
 * this service exists to replace.
 */
const LONG_FIRST_MESSAGE =
  'ok so I need you to look at the thing where the build keeps failing on windows but only when the cache is cold and then figure out why the esbuild step picks the wrong tsconfig and after that please make sure the fix also works on the linux runners because last time we fixed it for one and broke the other and I do not want to go through that again so check both before you tell me it is done';

const SLUG_FROM_LONG_MESSAGE =
  'ok-so-i-need-you-to-look-at-the-thing-where-the-build-keeps-failing-on-windows-but-only-when-the-cache-is-cold-and-then-figure-out-why-the-esbu';

function source(
  overrides: Partial<CandidateNamingSource> = {},
): CandidateNamingSource {
  return {
    slug: SLUG_FROM_LONG_MESSAGE,
    shortDescription: LONG_FIRST_MESSAGE.slice(0, 140),
    canonicalText: `[user] ${LONG_FIRST_MESSAGE}\n---\n[assistant] [tool:Edit]`,
    ...overrides,
  };
}

function makeStore(): SkillCandidateStore & { setDisplayName: jest.Mock } {
  const setDisplayName = jest.fn();
  return { setDisplayName } as unknown as SkillCandidateStore & {
    setDisplayName: jest.Mock;
  };
}

function makeNamer(scripts: StreamMessage[][]) {
  const logger = makeLogger();
  const query = makeQueryStub(scripts);
  const store = makeStore();
  const resolver = makeResolverStub(resolvedLane('judge'));
  const runner = new LaneRunnerService(
    logger,
    resolver.service,
    makeBudgetStub().store,
    query.query,
    null,
  );
  return {
    svc: new CandidateNamerService(logger, runner, store),
    query,
    store,
    resolver,
    logger,
  };
}

/** The naming lane is unavailable: this host registered no LLM. */
function makeHostlessNamer() {
  const logger = makeLogger();
  const store = makeStore();
  const runner = new LaneRunnerService(
    logger,
    makeResolverStub(resolvedLane('judge')).service,
    makeBudgetStub().store,
    null,
    null,
  );
  return { svc: new CandidateNamerService(logger, runner, store), store };
}

function naming(name: string, description = 'Use when the build fails.') {
  return resultMessage({ structured_output: { name, description } });
}

describe('CandidateNamerService', () => {
  describe('P1-10 (a) — a 400-char opening message yields a readable title', () => {
    it('produces a display name that is neither the slug nor over 60 chars', async () => {
      const { svc, store } = makeNamer([
        [naming('Fix Cold-Cache Windows Build Failures')],
      ]);

      const result = await svc.nameCandidate(CANDIDATE_ID, source());

      expect(result?.displayName).toBe('Fix Cold-Cache Windows Build Failures');
      expect(result?.displayName).not.toBe(SLUG_FROM_LONG_MESSAGE);
      expect(result?.displayName.length).toBeLessThanOrEqual(
        CANDIDATE_DISPLAY_NAME_MAX_CHARS,
      );
      expect(store.setDisplayName).toHaveBeenCalledWith(
        CANDIDATE_ID,
        'Fix Cold-Cache Windows Build Failures',
      );
    });

    it('clamps an over-long title to 60 chars on a word boundary', async () => {
      const { svc, store } = makeNamer([
        [
          naming(
            'Diagnose And Repair Cold Cache Windows Build Failures Across Both Runner Families',
          ),
        ],
      ]);

      const result = await svc.nameCandidate(CANDIDATE_ID, source());

      const written = store.setDisplayName.mock.calls[0][1] as string;
      expect(written.length).toBeLessThanOrEqual(
        CANDIDATE_DISPLAY_NAME_MAX_CHARS,
      );
      expect(written).toBe(result?.displayName);
      // A word-boundary cut, not a mid-word one.
      expect(written.endsWith(' ')).toBe(false);
      expect(LONG_FIRST_MESSAGE.startsWith(written)).toBe(false);
    });

    it('never writes the slug back as a title', async () => {
      const { svc, store } = makeNamer([[naming(SLUG_FROM_LONG_MESSAGE)]]);

      const result = await svc.nameCandidate(CANDIDATE_ID, source());

      expect(result).toBeNull();
      expect(store.setDisplayName).not.toHaveBeenCalled();
    });

    it('leaves the slug alone — it is still the internal id', async () => {
      const { svc, store } = makeNamer([[naming('Fix The Windows Build')]]);
      await svc.nameCandidate(CANDIDATE_ID, source());
      // `display_name` is the only column this service touches.
      expect(Object.keys(store)).toEqual(['setDisplayName']);
    });
  });

  describe('P1-10 (a) — an unavailable lane leaves display_name NULL', () => {
    it('writes nothing when this host has no lane', async () => {
      const { svc, store } = makeHostlessNamer();

      const result = await svc.nameCandidate(CANDIDATE_ID, source());

      expect(result).toBeNull();
      expect(store.setDisplayName).not.toHaveBeenCalled();
    });

    it('writes nothing when the lane throws', async () => {
      const logger = makeLogger();
      const store = makeStore();
      const runner = new LaneRunnerService(
        logger,
        makeThrowingResolverStub(new Error('provider down')),
        makeBudgetStub().store,
        makeQueryStub([[]]).query,
        null,
      );
      const svc = new CandidateNamerService(logger, runner, store);

      expect(await svc.nameCandidate(CANDIDATE_ID, source())).toBeNull();
      expect(store.setDisplayName).not.toHaveBeenCalled();
    });

    it('writes nothing when the lane produces nothing parseable', async () => {
      const { svc, store } = makeNamer([
        [assistantText('I could not name this'), resultMessage()],
        [assistantText('still no'), resultMessage()],
      ]);

      expect(await svc.nameCandidate(CANDIDATE_ID, source())).toBeNull();
      expect(store.setDisplayName).not.toHaveBeenCalled();
    });

    it('writes nothing when the answer is missing a field', async () => {
      const { svc, store } = makeNamer([
        [resultMessage({ structured_output: { name: 'Only A Name' } })],
      ]);

      expect(await svc.nameCandidate(CANDIDATE_ID, source())).toBeNull();
      expect(store.setDisplayName).not.toHaveBeenCalled();
    });

    it('writes nothing for a whitespace-only title', async () => {
      const { svc, store } = makeNamer([[naming('   ')]]);

      expect(await svc.nameCandidate(CANDIDATE_ID, source())).toBeNull();
      expect(store.setDisplayName).not.toHaveBeenCalled();
    });
  });

  describe('lane contract', () => {
    it('runs the cheap pass on the judge lane', async () => {
      const { svc, resolver } = makeNamer([[naming('A Title')]]);
      await svc.nameCandidate(CANDIDATE_ID, source());
      expect(resolver.resolve).toHaveBeenCalledWith('judge');
    });

    it('asks for {name, description} only — no body', async () => {
      const { svc, query } = makeNamer([[naming('A Title')]]);
      await svc.nameCandidate(CANDIDATE_ID, source());

      expect(query.calls[0].outputFormat).toEqual({
        type: 'json_schema',
        schema: CANDIDATE_NAMING_JSON_SCHEMA,
      });
      expect(CANDIDATE_NAMING_JSON_SCHEMA['required']).toEqual([
        'name',
        'description',
      ]);
      expect(CANDIDATE_NAMING_JSON_SCHEMA['properties']).not.toHaveProperty(
        'body',
      );
    });

    it('keeps the naming rubric out of the clippable prompt', async () => {
      const { svc, query } = makeNamer([[naming('A Title')]]);
      await svc.nameCandidate(CANDIDATE_ID, source());

      expect(query.calls[0].systemPromptAppend).toContain(
        `at most ${CANDIDATE_DISPLAY_NAME_MAX_CHARS} characters`,
      );
      expect(query.calls[0].prompt).toContain(LONG_FIRST_MESSAGE);
      expect(query.calls[0].prompt).not.toContain('Title Case');
    });
  });
});

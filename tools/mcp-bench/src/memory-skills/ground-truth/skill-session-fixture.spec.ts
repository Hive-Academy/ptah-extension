import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  buildManifest,
  verifyManifest,
  writeManifest,
} from './fixture-manifest';
import {
  buildSkillSessionFixtures,
  expectedEventsFromScript,
  skillSessionFixtureSchema,
  writeSkillSessionFixture,
} from './skill-session-fixture';

const fixtureDir = join(
  __dirname,
  '..',
  '..',
  '..',
  'fixtures',
  'memory-skills',
  'skill-sessions.v1',
);
const memorySkillsFixtureDir = join(
  __dirname,
  '..',
  '..',
  '..',
  'fixtures',
  'memory-skills',
);

describe('gt-skill-sessions@v1', () => {
  it('has the required labelled classes and validated scripts', () => {
    const fixtures = buildSkillSessionFixtures();
    expect(fixtures).toHaveLength(30);
    expect(fixtures.filter((fixture) => fixture.routine !== null)).toHaveLength(
      12,
    );
    expect(
      fixtures.filter(
        (fixture) => fixture.routine === null && !fixture.degraded,
      ),
    ).toHaveLength(10);
    expect(fixtures.filter((fixture) => fixture.degraded)).toHaveLength(8);
    for (const fixture of fixtures) {
      expect(skillSessionFixtureSchema.parse(fixture)).toEqual(fixture);
      expect(fixture.expectedEvents).toEqual(
        expectedEventsFromScript(fixture.script),
      );
    }
    for (const routine of [
      'dependency-upgrade',
      'incident-triage',
      'release-checklist',
      'test-failure-diagnosis',
    ]) {
      expect(
        fixtures.filter((fixture) => fixture.routine === routine),
      ).toHaveLength(3);
    }
  });

  it('pins degraded records and the repeated routine tool sequence', () => {
    const fixtures = buildSkillSessionFixtures();
    for (const fixture of fixtures.filter((entry) => entry.degraded)) {
      if (fixture.id <= 'skill-session-26') {
        expect(fixture.jsonl).toContain('{"type":"assistant","message":');
      } else {
        expect(fixture.jsonl).toContain('"type":"tool_use"');
        expect(fixture.jsonl).toContain('"name":"UnsupportedSyntheticTool"');
      }
    }
    for (const fixture of fixtures.filter((entry) => entry.routine !== null)) {
      expect(fixture.jsonl).toContain('"name":"Read"');
      expect(fixture.jsonl).toContain('"name":"Edit"');
      expect(fixture.jsonl).toContain('"name":"Bash"');
      expect(fixture.jsonl).toContain('"type":"tool_result"');
    }
    expect(
      fixtures
        .filter((entry) => entry.routine === null && !entry.degraded)
        .slice(0, 4)
        .every((entry) => !entry.jsonl.includes('"type":"tool_use"')),
    ).toBe(true);
  });

  it('matches the committed golden fixture', async () => {
    if (process.env['UPDATE_FIXTURES'] === '1') {
      await writeSkillSessionFixture(fixtureDir);
    }
    if (
      process.env['UPDATE_FIXTURES'] === '1' ||
      process.env['REBUILD_MANIFEST'] === '1'
    ) {
      await writeManifest(
        memorySkillsFixtureDir,
        await buildManifest(memorySkillsFixtureDir),
      );
    }
    const index = await readFile(join(fixtureDir, 'index.json'), 'utf8');
    expect(JSON.parse(index)).toEqual({
      fixture: 'gt-skill-sessions@v1',
      schemaVersion: 1,
      sessions: buildSkillSessionFixtures().map(
        ({ jsonl: _jsonl, ...session }) => session,
      ),
    });
    for (const fixture of buildSkillSessionFixtures()) {
      expect(
        await readFile(join(fixtureDir, `${fixture.id}.jsonl`), 'utf8'),
      ).toBe(fixture.jsonl);
    }
  });

  it('is byte-identical across in-memory generator runs', () => {
    expect(JSON.stringify(buildSkillSessionFixtures())).toBe(
      JSON.stringify(buildSkillSessionFixtures()),
    );
  });

  it('has a clean committed fixture manifest', async () => {
    expect(await verifyManifest(memorySkillsFixtureDir)).toEqual({
      ok: true,
      mismatches: [],
    });
  });
});

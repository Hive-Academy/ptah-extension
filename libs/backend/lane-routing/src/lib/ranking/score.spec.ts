import {
  LANE_DEFAULT_MODEL,
  type OutcomeTaskKind,
} from '@ptah-extension/shared';
import { AUTOMATIC_MATRIX_MODEL } from '../matrix/local-derivation';
import { FAMILY_PROFILE_MODEL, type MatrixCell } from '../matrix/matrix.types';
import { CLOSENESS_BAND, NEUTRAL_SCORE } from '../routing-constants';
import { toSubagentCandidate, type LaneCandidate } from './candidate.types';
import {
  score,
  type ListedModel,
  type ScoreCell,
  type ScoreInput,
  type ScoreMatrix,
} from './score';

/**
 * Lookup that follows `profileModelFor`: `lane-default`, `auto`, and a
 * model with no row read the family profile (`*`).
 */
function matrixOf(
  rows: readonly (readonly [string, string, OutcomeTaskKind, number])[],
): ScoreMatrix {
  const scores = new Map<string, number>();
  for (const [family, model, taskKind, value] of rows) {
    scores.set(`${family}\0${model}\0${taskKind}`, value);
  }
  return {
    resolve(family, model, taskKind): ScoreCell {
      const own = scores.get(`${family}\0${model}\0${taskKind}`);
      const familyScore = scores.get(
        `${family}\0${FAMILY_PROFILE_MODEL}\0${taskKind}`,
      );
      const useFamily =
        model === LANE_DEFAULT_MODEL ||
        model === AUTOMATIC_MATRIX_MODEL ||
        own === undefined;
      const value = useFamily ? familyScore : own;
      if (value === undefined) {
        return {
          score: NEUTRAL_SCORE,
          cell: { kind: 'unknown' },
          profileModel: FAMILY_PROFILE_MODEL,
          noProfile: true,
        };
      }
      const cell: MatrixCell = {
        kind: 'value',
        score: value,
        source: 'seed',
        asOf: '2026-02-19',
        stale: false,
      };
      return {
        score: value,
        cell,
        profileModel: useFamily ? FAMILY_PROFILE_MODEL : model,
        noProfile: false,
      };
    },
  };
}

function lane(family: string, id = family): LaneCandidate {
  return {
    kind: 'lane',
    id,
    cli: 'codex',
    family,
    installed: true,
    disabled: false,
    limitState: 'confirmed-room',
  };
}

function listed(
  id: string,
  provenance: ListedModel['provenance'] = 'reported',
  auto?: boolean,
): ListedModel {
  return auto === undefined ? { id, provenance } : { id, provenance, auto };
}

const FAMILY = 50;

function codexMatrix(
  modelScores: Readonly<Record<string, number>>,
  familyScore = FAMILY,
): ScoreMatrix {
  const rows: (readonly [string, string, OutcomeTaskKind, number])[] = [
    ['codex', FAMILY_PROFILE_MODEL, 'implement', familyScore],
  ];
  for (const [model, value] of Object.entries(modelScores)) {
    rows.push(['codex', model, 'implement', value]);
  }
  return matrixOf(rows);
}

describe('score', () => {
  it('pins the closeness band used to promote a listed model', () => {
    expect(CLOSENESS_BAND).toBe(5);
  });

  it('promotes a listed model that beats the family cell by more than B', () => {
    const result = score(
      {
        candidate: lane('codex'),
        models: [listed('gpt-5.4')],
        configuredModel: { id: 'configured-id', provenance: 'configured' },
      },
      'implement',
      codexMatrix({ 'gpt-5.4': FAMILY + CLOSENESS_BAND + 1 }),
    );

    expect(result.model).toBe('gpt-5.4');
    expect(result.provenance).toBe('reported');
    expect(result.score).toBe(FAMILY + CLOSENESS_BAND + 1);
    expect(result.profileModel).toBe('gpt-5.4');
    expect(result.noProfile).toBe(false);
    expect(result.cell).toMatchObject({ kind: 'value', source: 'seed' });
  });

  it('does not promote a listed model exactly B above the family cell', () => {
    const result = score(
      {
        candidate: lane('codex'),
        models: [listed('gpt-5.4')],
        configuredModel: { id: 'glm-5', provenance: 'configured' },
      },
      'implement',
      codexMatrix({
        'gpt-5.4': FAMILY + CLOSENESS_BAND,
        'glm-5': 70,
      }),
    );

    expect(result.model).toBe('glm-5');
    expect(result.provenance).toBe('configured');
    expect(result.score).toBe(70);
  });

  it('does not promote a listed model B-1 above the family cell', () => {
    const result = score(
      {
        candidate: lane('codex'),
        models: [listed('gpt-5.4')],
      },
      'implement',
      codexMatrix({ 'gpt-5.4': FAMILY + CLOSENESS_BAND - 1 }),
    );

    expect(result.model).toBe(LANE_DEFAULT_MODEL);
    expect(result.provenance).toBe('lane-default');
    expect(result.score).toBe(FAMILY);
    expect(result.profileModel).toBe(FAMILY_PROFILE_MODEL);
  });

  it('keeps the highest listed model that clears the band', () => {
    const result = score(
      {
        candidate: lane('codex'),
        models: [listed('lower'), listed('higher', 'fallback')],
      },
      'implement',
      codexMatrix({
        lower: FAMILY + CLOSENESS_BAND + 1,
        higher: FAMILY + CLOSENESS_BAND + 10,
      }),
    );

    expect(result.model).toBe('higher');
    expect(result.provenance).toBe('fallback');
    expect(result.score).toBe(FAMILY + CLOSENESS_BAND + 10);
  });

  it('keeps the earlier listed model when promoted scores tie', () => {
    const tied = FAMILY + CLOSENESS_BAND + 1;
    const result = score(
      {
        candidate: lane('codex'),
        models: [listed('z-model'), listed('a-model')],
      },
      'implement',
      codexMatrix({ 'z-model': tied, 'a-model': tied }),
    );

    expect(result.model).toBe('z-model');
    expect(result.score).toBe(tied);
  });

  it('uses the configured model when no listed model clears the band', () => {
    const result = score(
      {
        candidate: lane('codex'),
        models: [listed('gpt-5.4')],
        configuredModel: { id: 'glm-5', provenance: 'configured' },
      },
      'implement',
      codexMatrix({ 'gpt-5.4': FAMILY + 1, 'glm-5': 65 }),
    );

    expect(result.model).toBe('glm-5');
    expect(result.provenance).toBe('configured');
    expect(result.score).toBe(65);
  });

  it('keeps a configured model id when that model has no profile of its own', () => {
    const result = score(
      {
        candidate: lane('codex'),
        configuredModel: { id: 'glm-5', provenance: 'configured' },
      },
      'implement',
      codexMatrix({}),
    );

    expect(result.model).toBe('glm-5');
    expect(result.provenance).toBe('configured');
    expect(result.score).toBe(FAMILY);
    expect(result.profileModel).toBe(FAMILY_PROFILE_MODEL);
  });

  it('uses a subagent tier when no listed model clears the band', () => {
    const result = score(
      {
        candidate: toSubagentCandidate('reviewer'),
        configuredModel: { id: 'opus', provenance: 'tier' },
      },
      'review',
      matrixOf([['claude', 'opus', 'review', 65]]),
    );

    expect(result.model).toBe('opus');
    expect(result.provenance).toBe('tier');
    expect(result.score).toBe(65);
    expect(result.candidate.id).toBe('subagent:reviewer');
  });

  it('uses lane-default and the neutral score when the cell is unknown', () => {
    const result = score(
      { candidate: lane('unseen') },
      'implement',
      matrixOf([]),
    );

    expect(result.model).toBe(LANE_DEFAULT_MODEL);
    expect(result.provenance).toBe('lane-default');
    expect(result.score).toBe(NEUTRAL_SCORE);
    expect(result.noProfile).toBe(true);
    expect(result.cell).toEqual({ kind: 'unknown' });
  });

  it('reads the family profile for lane-default', () => {
    const result = score(
      { candidate: lane('codex') },
      'implement',
      codexMatrix({}, 65),
    );

    expect(result.model).toBe(LANE_DEFAULT_MODEL);
    expect(result.score).toBe(65);
    expect(result.profileModel).toBe(FAMILY_PROFILE_MODEL);
  });

  it('treats a configured auto id as lane-default', () => {
    const result = score(
      {
        candidate: lane('codex'),
        configuredModel: {
          id: AUTOMATIC_MATRIX_MODEL,
          provenance: 'configured',
        },
      },
      'implement',
      codexMatrix({ auto: 90 }, 65),
    );

    expect(result.model).toBe(LANE_DEFAULT_MODEL);
    expect(result.provenance).toBe('lane-default');
    expect(result.score).toBe(65);
  });

  it('skips an auto listing and a lane-default listing', () => {
    const result = score(
      {
        candidate: lane('codex'),
        models: [
          listed('gpt-5.4', 'reported', true),
          listed(LANE_DEFAULT_MODEL, 'fallback'),
        ],
      },
      'implement',
      codexMatrix({ 'gpt-5.4': 90 }, 65),
    );

    expect(result.model).toBe(LANE_DEFAULT_MODEL);
    expect(result.score).toBe(65);
  });

  it('does not promote a listed model that resolves to the family profile', () => {
    const result = score(
      {
        candidate: lane('codex'),
        models: [listed('missing-model')],
      },
      'implement',
      codexMatrix({}, 65),
    );

    expect(result.model).toBe(LANE_DEFAULT_MODEL);
    expect(result.score).toBe(65);
  });

  it('scores the task kind that was asked for', () => {
    const result = score(
      { candidate: lane('codex') },
      'plan',
      matrixOf([
        ['codex', FAMILY_PROFILE_MODEL, 'implement', 80],
        ['codex', FAMILY_PROFILE_MODEL, 'plan', 35],
      ]),
    );

    expect(result.score).toBe(35);
  });

  it('scores from the family and model, not from the lane id', () => {
    const lookup = codexMatrix({}, 65);
    const left = score(
      { candidate: lane('codex', 'codex') },
      'implement',
      lookup,
    );
    const right = score(
      { candidate: lane('codex', 'other') },
      'implement',
      lookup,
    );

    expect(left.score).toBe(right.score);
    expect(left.model).toBe(right.model);
  });

  it('returns the same score for the same input', () => {
    const models = [listed('gpt-5.4')];
    const input: ScoreInput = {
      candidate: lane('codex'),
      models,
      configuredModel: { id: 'glm-5', provenance: 'configured' },
    };
    const lookup = codexMatrix({ 'gpt-5.4': 52, 'glm-5': 70 });

    expect(score(input, 'implement', lookup)).toEqual(
      score(input, 'implement', lookup),
    );
    expect(models).toEqual([listed('gpt-5.4')]);
  });

  it('rejects a matrix score that is not an integer on the scale', () => {
    const lookup: ScoreMatrix = {
      resolve: () => ({
        score: 50.5,
        cell: { kind: 'unknown' },
        profileModel: FAMILY_PROFILE_MODEL,
        noProfile: true,
      }),
    };

    expect(() =>
      score({ candidate: lane('codex') }, 'implement', lookup),
    ).toThrow(/integer/);
  });
});

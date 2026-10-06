import 'reflect-metadata';

jest.mock('vscode', () => ({}), { virtual: true });

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  MEMORY_CONTRACT_TOKENS,
  type ICuratorLLM,
} from '@ptah-extension/memory-contracts';
import { SKILL_SYNTHESIS_TOKENS } from '@ptah-extension/skill-synthesis';
import { container as rootContainer, type DependencyContainer } from 'tsyringe';

import { CassetteMissError } from '../doubles/cassette-store';
import { curatorExtractKey } from '../doubles/recorded-curator-llm';
import {
  DoublesOverrideError,
  installRecordReplayDoubles,
} from './doubles-override';
import type { MemorySkillsPlan } from './plan.schema';

const CURATOR = MEMORY_CONTRACT_TOKENS.CURATOR_LLM;
const LANE = SKILL_SYNTHESIS_TOKENS.LANE_RUNNER_SERVICE;

describe('installRecordReplayDoubles', () => {
  let dir: string;
  let container: DependencyContainer;
  let cassettes: MemorySkillsPlan['cassettes'];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ptah-620-doubles-'));
    container = rootContainer.createChildContainer();
    cassettes = {
      curator: { path: join(dir, 'curator.jsonl'), model: 'm-1' },
      laneRunner: { path: join(dir, 'lane.jsonl'), model: 'm-1' },
    };
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('replay: registers both doubles and never constructs the real adapters', async () => {
    const realCurator = jest.fn(() => {
      throw new Error('real curator constructed');
    });
    const realLane = jest.fn(() => {
      throw new Error('real lane runner constructed');
    });
    container.register(CURATOR, { useFactory: realCurator });
    container.register(LANE, { useFactory: realLane });

    const doubles = installRecordReplayDoubles(container, {
      cassetteMode: 'replay',
      cassettes,
    });

    expect(doubles.mode).toBe('replay');
    expect(container.resolve(CURATOR)).toBe(doubles.curator);
    expect(container.resolve(LANE)).toBe(doubles.laneRunner);
    expect(realCurator).not.toHaveBeenCalled();
    expect(realLane).not.toHaveBeenCalled();
    // A replay double serves only the cassette: an unrecorded call is a miss,
    // never a fall-through to a model.
    await expect(
      container.resolve<ICuratorLLM>(CURATOR).extract('transcript'),
    ).rejects.toBeInstanceOf(CassetteMissError);
  });

  it('replay: works when the real adapters are not registered at all', () => {
    const doubles = installRecordReplayDoubles(container, {
      cassetteMode: 'replay',
      cassettes,
    });
    expect(container.resolve(CURATOR)).toBe(doubles.curator);
    expect(container.resolve(LANE)).toBe(doubles.laneRunner);
  });

  it('replay: passes curator faults to the double', async () => {
    const key = curatorExtractKey('t');
    const doubles = installRecordReplayDoubles(container, {
      cassetteMode: 'replay',
      cassettes: {
        ...cassettes,
        curator: { ...cassettes.curator, faults: { [key]: 'throw' } },
      },
    });
    await expect(doubles.curator.extract('t')).rejects.toThrow();
    expect(() => doubles.curator.assertAllFaultsHit()).not.toThrow();
  });

  it('record: wraps the real adapters it resolves', async () => {
    const realCurator: ICuratorLLM = {
      extract: jest.fn(async () => ({ drafts: [] }) as never),
      resolve: jest.fn(async () => []),
    };
    const realLane = { run: jest.fn() };
    container.register(CURATOR, { useValue: realCurator });
    container.register(LANE, { useValue: realLane });

    const doubles = installRecordReplayDoubles(container, {
      cassetteMode: 'record',
      cassettes,
    });

    expect(container.resolve(CURATOR)).toBe(doubles.curator);
    await doubles.curator.extract('hello');
    expect(realCurator.extract).toHaveBeenCalledTimes(1);
  });

  it('record: refuses when a real adapter is missing', () => {
    container.register(LANE, { useValue: { run: jest.fn() } });
    expect(() =>
      installRecordReplayDoubles(container, {
        cassetteMode: 'record',
        cassettes,
      }),
    ).toThrow(DoublesOverrideError);
  });

  it('fails when the container does not resolve the doubles afterwards', () => {
    const stuck = {
      isRegistered: () => true,
      register: jest.fn(),
      resolve: () => ({ real: true }),
    } as unknown as DependencyContainer;
    expect(() =>
      installRecordReplayDoubles(stuck, { cassetteMode: 'replay', cassettes }),
    ).toThrow(
      'CURATOR_LLM does not resolve to the record/replay double after the override',
    );
  });
});

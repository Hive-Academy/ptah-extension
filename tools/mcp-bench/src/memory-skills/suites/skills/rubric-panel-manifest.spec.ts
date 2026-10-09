import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadRubricPanelManifest } from './rubric-panel-manifest';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rubric-panel-manifest-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeManifest(value: unknown): void {
  const path = join(dir, 'labelling', 'merged', 'u1-rubric.manifest.json');
  mkdirSync(join(dir, 'labelling', 'merged'), { recursive: true });
  writeFileSync(path, JSON.stringify(value), 'utf8');
}

function lane(
  raterId: string,
  family: string,
  provider: string,
  model: string,
) {
  return {
    raterId,
    family,
    provider,
    model,
    promptSha256: 'ab'.repeat(32),
    packetCount: 105,
    responseCount: 105,
    failureCount: 0,
    timestamp: '2026-10-07T00:00:00.000Z',
  };
}

describe('loadRubricPanelManifest', () => {
  it('reports a missing private manifest', () => {
    expect(loadRubricPanelManifest(dir)).toEqual({
      ok: false,
      reason: 'panel-manifest-missing',
    });
  });

  it('reports invalid JSON without exposing file content', () => {
    const path = join(dir, 'labelling', 'merged', 'u1-rubric.manifest.json');
    mkdirSync(join(dir, 'labelling', 'merged'), { recursive: true });
    writeFileSync(path, '{invalid', 'utf8');

    expect(loadRubricPanelManifest(dir)).toEqual({
      ok: false,
      reason: 'panel-manifest-invalid',
    });
  });

  it('reports a schema failure without exposing file content', () => {
    writeManifest({ population: 105 });

    expect(loadRubricPanelManifest(dir)).toEqual({
      ok: false,
      reason: 'panel-manifest-invalid',
    });
  });

  it('loads a valid manifest with the U1 panel lanes', () => {
    writeManifest({
      raters: [
        lane('r1', 'xAI', 'grok', 'grok-4.7'),
        lane('r2', 'Google', 'antigravity', 'gemini-3.1-pro'),
      ],
      adjudicator: lane(
        'adj-glm',
        'GLM',
        'ollama-cloud',
        'glm-5.3-flash:cloud',
      ),
      population: 105,
      unresolvedCount: 0,
      unresolvedShare: 0,
    });

    expect(loadRubricPanelManifest(dir)).toMatchObject({
      ok: true,
      panel: {
        population: 105,
        raters: [
          { provider: 'grok', model: 'grok-4.7', family: 'xAI' },
          {
            provider: 'antigravity',
            model: 'gemini-3.1-pro',
            family: 'Google',
          },
        ],
        adjudicator: {
          provider: 'ollama-cloud',
          model: 'glm-5.3-flash:cloud',
          family: 'GLM',
        },
      },
    });
  });
});

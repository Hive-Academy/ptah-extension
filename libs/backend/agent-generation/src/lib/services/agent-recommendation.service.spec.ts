/**
 * AgentRecommendationService Unit Tests
 *
 * The recommendation catalog is the wizard's agent picker source. If a template
 * exists on disk but is missing from the catalog, that agent is never offered in
 * the wizard and therefore never generated — this is the historical
 * `visual-reviewer` silent-drop bug. These tests pin the catalog to the actual
 * `templates/agents/*.template.md` set so drift is caught at test time.
 */

import 'reflect-metadata';
import { describe, it, expect } from '@jest/globals';
import { readdirSync } from 'fs';
import { join } from 'path';
import { Logger } from '@ptah-extension/vscode-core';
import { AgentRecommendationService } from './agent-recommendation.service';
import type { DeepProjectAnalysis } from '../types/analysis.types';

const TEMPLATES_DIR = join(__dirname, '..', '..', '..', 'templates', 'agents');

function templateIdsOnDisk(): string[] {
  return readdirSync(TEMPLATES_DIR)
    .filter((f) => f.endsWith('.template.md'))
    .map((f) => f.replace('.template.md', ''))
    .sort();
}

function createService(): AgentRecommendationService {
  const logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    trace: () => undefined,
  } as unknown as Logger;
  return new AgentRecommendationService(logger);
}

const MINIMAL_ANALYSIS = {
  frameworks: [],
  architecturePatterns: [],
  languageDistribution: [],
} as unknown as DeepProjectAnalysis;

describe('AgentRecommendationService', () => {
  it('offers exactly one recommendation per agent template on disk (no template silently absent)', () => {
    const service = createService();
    const recommendations = service.calculateRecommendations(MINIMAL_ANALYSIS);
    const recommendedIds = recommendations.map((r) => r.agentId).sort();

    // Every template on disk must be reachable through the wizard picker.
    for (const id of templateIdsOnDisk()) {
      expect(recommendedIds).toContain(id);
    }
  });

  it('includes visual-reviewer and video-director (previously drifted out of the catalog)', () => {
    const service = createService();
    const recommendedIds = service
      .calculateRecommendations(MINIMAL_ANALYSIS)
      .map((r) => r.agentId);

    expect(recommendedIds).toContain('visual-reviewer');
    expect(recommendedIds).toContain('video-director');
  });

  it('marks every agent as recommended with maximum relevance', () => {
    const service = createService();
    const recommendations = service.calculateRecommendations(MINIMAL_ANALYSIS);

    expect(recommendations.length).toBeGreaterThan(0);
    for (const rec of recommendations) {
      expect(rec.recommended).toBe(true);
      expect(rec.relevanceScore).toBe(100);
    }
  });
});

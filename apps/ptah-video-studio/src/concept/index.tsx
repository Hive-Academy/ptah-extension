/**
 * Concept-scene registry — animated explainer scenes a promo spec references by
 * key (`{ "kind": "scene", "scene": "decision-tree" }`). Each scene demonstrates
 * one idea from the Dyad-vs-Ptah narrative visually instead of describing it.
 */
import type React from 'react';
import type { ConceptSceneProps } from '../PromoReel';
import { ColdStart } from './ColdStart';
import { TheFork } from './TheFork';
import { Contenders } from './Contenders';
import { Philosophy } from './Philosophy';
import { DyadArchitecture } from './DyadArchitecture';
import { DyadCeiling } from './DyadCeiling';
import { PtahRoadmap } from './PtahRoadmap';
import { PtahQuadrant } from './PtahQuadrant';
import { PtahOrchestra } from './PtahOrchestra';
import { DecisionTree } from './DecisionTree';
import { ProviderOrbit } from '../concept3d/ProviderOrbit';
import { McpRoundtrips } from '../concept3d/McpRoundtrips';
import { McpOneTool } from '../concept3d/McpOneTool';
import { McpSandbox } from '../concept3d/McpSandbox';
import { McpResult } from '../concept3d/McpResult';
import { AgentShowcase } from '../concept3d/AgentShowcase';
import { AssetSheet } from '../concept3d/AssetSheet';
import { StateOfArtProof } from './StateOfArtProof';
import { GlassCoreScene } from './GlassCoreScene';
import {
  StoryHook,
  StoryPositioning,
  StoryWizard,
  StoryOrchestration,
  StoryFoundation,
  StoryLifecycle,
  StoryProof,
  StoryCta,
} from './story-scenes';

export type ConceptScene = React.FC<ConceptSceneProps>;

export const CONCEPT_SCENES: Record<string, ConceptScene> = {
  'cold-start': ColdStart,
  'the-fork': TheFork,
  contenders: Contenders,
  philosophy: Philosophy,
  'dyad-arch': DyadArchitecture,
  'dyad-ceiling': DyadCeiling,
  'ptah-roadmap': PtahRoadmap,
  'ptah-quadrant': PtahQuadrant,
  'ptah-orchestra': PtahOrchestra,
  'decision-tree': DecisionTree,
  // 3D scenes (src/concept3d — R3F via @remotion/three, see three-kit).
  'provider-orbit': ProviderOrbit,
  'mcp-roundtrips': McpRoundtrips,
  'mcp-one-tool': McpOneTool,
  'mcp-sandbox': McpSandbox,
  'mcp-result': McpResult,
  'agent-showcase': AgentShowcase,
  'asset-sheet': AssetSheet,
  // State-of-the-art proof — remocn motion-design + high-fidelity abstract 3D.
  'state-of-art-proof': StateOfArtProof,
  // Elevated crisp-crystal glass hero (checkpoint + beat-5 spine).
  'glass-hero': GlassCoreScene,
  // "From Cold Clone to Scalable SaaS" — the 8-beat master reel.
  'story-hook': StoryHook,
  'story-positioning': StoryPositioning,
  'story-wizard': StoryWizard,
  'story-orchestration': StoryOrchestration,
  'story-foundation': StoryFoundation,
  'story-lifecycle': StoryLifecycle,
  'story-proof': StoryProof,
  'story-cta': StoryCta,
};

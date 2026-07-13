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
};

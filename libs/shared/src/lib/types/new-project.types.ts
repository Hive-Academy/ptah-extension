/**
 * New Project Wizard Types
 *
 * Types for the "Start New Project" setup wizard flow.
 * Covers project type selection, discovery questions,
 * master plan generation, and RPC contracts.
 */

// ============================================================
// Project Types
// ============================================================

export type NewProjectType =
  | 'full-saas'
  | 'nestjs-api'
  | 'angular-app'
  | 'react-app';

export interface NewProjectTypeInfo {
  id: NewProjectType;
  label: string;
  description: string;
  icon: string;
  techStack: string[];
}

// ============================================================
// Question System
// ============================================================

export type QuestionInputType = 'single-select' | 'multi-select' | 'text';

export interface DiscoveryQuestionOption {
  value: string;
  label: string;
  description?: string;
}

export interface DiscoveryQuestion {
  id: string;
  text: string;
  inputType: QuestionInputType;
  options?: DiscoveryQuestionOption[];
  placeholder?: string;
  defaultValue?: string | string[];
  required: boolean;
  minSelections?: number;
  maxSelections?: number;
}

export interface QuestionGroup {
  id: string;
  title: string;
  description: string;
  questions: DiscoveryQuestion[];
}

export interface ProjectTypeQuestionConfig {
  projectType: NewProjectType;
  groups: QuestionGroup[];
}

// ============================================================
// Discovery Answers
// ============================================================

export type AnswerValue = string | string[];

export type DiscoveryAnswers = Record<string, AnswerValue>;

// ============================================================
// Master Plan Schema
// ============================================================

export interface MasterPlanTask {
  id: string;
  title: string;
  description: string;
  agentType:
    | 'backend-developer'
    | 'frontend-developer'
    | 'devops-engineer'
    | 'software-architect';
  filePaths: string[];
}

export interface MasterPlanPhase {
  id: string;
  name: string;
  description: string;
  tasks: MasterPlanTask[];
  dependsOn: string[];
}

export interface MasterPlanArchitectureDecision {
  area: string;
  decision: string;
  rationale: string;
}

export interface MasterPlan {
  projectName: string;
  projectType: NewProjectType;
  techStack: string[];
  architectureDecisions: MasterPlanArchitectureDecision[];
  directoryStructure: string;
  phases: MasterPlanPhase[];
  summary: string;
}

// ============================================================
// RPC Types
// ============================================================

export interface NewProjectSelectTypeParams {
  projectType: NewProjectType;
}

export interface NewProjectSelectTypeResponse {
  groups: QuestionGroup[];
}

export interface NewProjectSubmitAnswersParams {
  projectType: NewProjectType;
  answers: DiscoveryAnswers;
  projectName: string;
}

export interface NewProjectSubmitAnswersResponse {
  success: boolean;
  error?: string;
}

export interface NewProjectGetPlanResponse {
  plan: MasterPlan;
}

export interface NewProjectApprovePlanParams {
  approved: boolean;
}

export interface NewProjectApprovePlanResponse {
  success: boolean;
  planPath: string;
}

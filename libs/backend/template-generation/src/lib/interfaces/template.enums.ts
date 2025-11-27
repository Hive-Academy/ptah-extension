/**
 * Template generation enums
 * Adapted from roocode-generator memory-bank enums
 */

export enum TemplateFileType {
  ProjectOverview = 'ProjectOverview',
  TechnicalArchitecture = 'TechnicalArchitecture',
  DeveloperGuide = 'DeveloperGuide',
  ClaudeMd = 'ClaudeMd', // Ptah-specific: CLAUDE.md generation
}

export enum TemplateType {
  ImplementationPlan = 'implementation-plan',
  TaskDescription = 'task-description',
  ClaudeMd = 'claude-md', // Ptah-specific
}

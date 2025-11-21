import {
  CircleDotIcon,
  SearchIcon,
  MapIcon,
  TrendingUpIcon,
  ServerIcon,
  ClipboardIcon,
  SparklesIcon,
  PaintBucketIcon,
  FileCheckIcon,
  Building2Icon,
  FlaskConicalIcon,
  BookOpenIcon,
  PaletteIcon,
  UsersIcon,
  GitBranchIcon,
  SettingsIcon,
  TerminalIcon,
  FileTextIcon,
  Edit3Icon,
  FileEditIcon,
  FolderSearchIcon,
  GlobeIcon,
  WrenchIcon,
} from 'lucide-angular';

/**
 * Maps agent types to lucide-angular icon components
 *
 * Supports 15 agent types with semantic icon mappings:
 * - general-purpose: CircleDotIcon (flexible, all-purpose)
 * - Explore: SearchIcon (code exploration, discovery)
 * - Plan: MapIcon (strategic planning, design)
 * - business-analyst: TrendingUpIcon (scope validation, analysis)
 * - backend-developer: ServerIcon (server-side implementation)
 * - project-manager: ClipboardIcon (requirements, task management)
 * - modernization-detector: SparklesIcon (tech stack modernization)
 * - frontend-developer: PaintBucketIcon (UI/UX implementation)
 * - code-reviewer: FileCheckIcon (code quality validation)
 * - software-architect: Building2Icon (system design, architecture)
 * - senior-tester: FlaskConicalIcon (quality assurance, testing)
 * - researcher-expert: BookOpenIcon (deep research, knowledge)
 * - ui-ux-designer: PaletteIcon (visual design specifications)
 * - team-leader: UsersIcon (task delegation, coordination)
 * - statusline-setup: SettingsIcon (configuration, setup)
 */
export const AGENT_ICON_MAP: Record<string, typeof SearchIcon> = {
  'general-purpose': CircleDotIcon,
  Explore: SearchIcon,
  Plan: MapIcon,
  'business-analyst': TrendingUpIcon,
  'backend-developer': ServerIcon,
  'project-manager': ClipboardIcon,
  'modernization-detector': SparklesIcon,
  'frontend-developer': PaintBucketIcon,
  'code-reviewer': FileCheckIcon,
  'software-architect': Building2Icon,
  'senior-tester': FlaskConicalIcon,
  'researcher-expert': BookOpenIcon,
  'ui-ux-designer': PaletteIcon,
  'team-leader': UsersIcon,
  'statusline-setup': SettingsIcon,
};

/**
 * Maps agent types to VS Code semantic color variables
 *
 * Colors are chosen to match VS Code's semantic token coloring:
 * - Function foreground for backend (code execution)
 * - Class foreground for frontend/explore (structure)
 * - Testing colors for code-reviewer/tester (validation)
 * - Symbol colors for various roles (semantic grouping)
 */
export const AGENT_COLOR_MAP: Record<string, string> = {
  'general-purpose': 'var(--vscode-editor-foreground)',
  Explore: 'var(--vscode-symbolIcon-classForeground)',
  Plan: 'var(--vscode-symbolIcon-namespaceForeground)',
  'business-analyst': 'var(--vscode-charts-blue)',
  'backend-developer': 'var(--vscode-symbolIcon-functionForeground)',
  'project-manager': 'var(--vscode-symbolIcon-constantForeground)',
  'modernization-detector': 'var(--vscode-symbolIcon-keywordForeground)',
  'frontend-developer': 'var(--vscode-symbolIcon-classForeground)',
  'code-reviewer': 'var(--vscode-testing-iconPassed)',
  'software-architect': 'var(--vscode-symbolIcon-moduleForeground)',
  'senior-tester': 'var(--vscode-testing-iconQueued)',
  'researcher-expert': 'var(--vscode-symbolIcon-stringForeground)',
  'ui-ux-designer': 'var(--vscode-symbolIcon-colorForeground)',
  'team-leader': 'var(--vscode-symbolIcon-interfaceForeground)',
  'statusline-setup': 'var(--vscode-symbolIcon-variableForeground)',
};

/**
 * Maps tool names to lucide-angular icon components
 *
 * Supports 8 tool types used in agent activities:
 * - Bash: TerminalIcon (terminal/shell commands)
 * - Read: FileTextIcon (file reading)
 * - Edit: Edit3Icon (file editing)
 * - Write: FileEditIcon (file writing)
 * - Grep: SearchIcon (content search)
 * - Glob: FolderSearchIcon (file pattern search)
 * - WebFetch: GlobeIcon (web content retrieval)
 * - WebSearch: SearchIcon (web search)
 */
export const TOOL_ICON_MAP: Record<string, typeof TerminalIcon> = {
  Bash: TerminalIcon,
  Read: FileTextIcon,
  Edit: Edit3Icon,
  Write: FileEditIcon,
  Grep: SearchIcon,
  Glob: FolderSearchIcon,
  WebFetch: GlobeIcon,
  WebSearch: SearchIcon,
};

/**
 * Default fallback icon for unknown agent types
 *
 * Uses CircleDotIcon as a neutral, non-specific indicator
 */
export const DEFAULT_ICON = CircleDotIcon;

/**
 * Default fallback icon for unknown tool types
 *
 * Uses WrenchIcon as a generic tool indicator
 */
export const DEFAULT_TOOL_ICON = WrenchIcon;

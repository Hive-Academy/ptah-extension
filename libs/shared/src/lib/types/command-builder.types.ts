export interface CommandTemplate {
  id: string;
  name: string;
  description: string;
  category:
    | 'analysis'
    | 'testing'
    | 'documentation'
    | 'optimization'
    | 'custom';
  template: string;
  icon: string;
  tags: string[];
  parameters: TemplateParameter[];
  examples?: TemplateExample[];
  createdAt?: Date;
  updatedAt?: Date;
  author?: string;
}

export interface TemplateParameter {
  name: string;
  type: 'string' | 'file' | 'select' | 'multiselect' | 'number' | 'boolean';
  required: boolean;
  description: string;
  placeholder?: string;
  defaultValue?: string | number | boolean | readonly string[];
  options?: string[];
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
    message?: string;
  };
}

export interface TemplateExample {
  title: string;
  description: string;
  parameters: Readonly<
    Record<string, string | number | boolean | readonly string[]>
  >;
}

export interface CommandBuilderMessage {
  type:
    | 'getTemplates'
    | 'getTemplate'
    | 'executeCommand'
    | 'saveTemplate'
    | 'deleteTemplate'
    | 'trackUsage'
    | 'selectFile'
    | 'ready';
  payload?: unknown;
}

export interface CommandBuilderResponse {
  type:
    | 'templates'
    | 'template'
    | 'commandResult'
    | 'error'
    | 'fileSelected'
    | 'ready';
  payload?: unknown;
  error?: string;
}

export interface ExecuteCommandRequest {
  templateId: string;
  parameters: Readonly<
    Record<string, string | number | boolean | readonly string[]>
  >;
  context?: {
    workspaceFolder?: string;
    activeFile?: string;
    selectedText?: string;
  };
}

export interface CommandResult {
  success: boolean;
  output?: string;
  error?: string;
  duration?: number;
  timestamp: Date;
  stdout?: string;
  stderr?: string;
  code?: string;
}

export interface CommandBuildResult {
  command: string;
  parameters: Readonly<
    Record<string, string | number | boolean | readonly string[]>
  >;
  template: CommandTemplate;
}

import { TemplateFileType, TemplateType } from './template.enums';

/**
 * Template generation configuration
 * Adapted from roocode-generator MemoryBankConfig
 */
export interface TemplateConfig {
  requiredFiles: TemplateFileType[];
  templateFiles: TemplateType[];
  baseDir: string;
  templateDir: string;
}

/**
 * Template Generation Library
 * Public API barrel exports
 */

// Interfaces
export * from './interfaces';

// Errors
export * from './errors';

// Services (only export main entry point and DI registration)
export { TemplateGeneratorService } from './services/template-generator.service';

// DI Registration
export { registerTemplateGeneration } from './di/registration';

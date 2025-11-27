/**
 * Template Generation Library
 * Public API barrel exports
 */

// Interfaces
export * from './lib/interfaces';

// Errors
export * from './lib/errors';

// Services (only export main entry point and DI registration)
export { TemplateGeneratorService } from './lib/services/template-generator.service';

// DI Registration
export { registerTemplateGeneration } from './lib/di/registration';

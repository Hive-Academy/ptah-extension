/**
 * Auth Module Barrel Export
 *
 * Re-exports all auth-related types, utilities, and components
 */

// Types
export * from './models/auth.types';

// Utilities
export * from './utils/auth-validation.utils';

// Animation Configs
export * from './config/auth-animation.configs';

// Services
export { AuthApiService } from './services/auth-api.service';

// Components
export * from './components';

// Page Component
export { AuthPageComponent } from './auth-page.component';

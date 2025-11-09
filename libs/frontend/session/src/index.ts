/**
 * Session Library - Public API
 *
 * **Purpose**: Session management functionality for Ptah Extension
 * **Features**:
 * - Session selection and switching
 * - Session creation (quick and named)
 * - Session lifecycle management
 * - Session display components
 *
 * **Migration Status**: Step 5 - Feature Libraries Phase 2
 * **Components**: 3 total (1/3 complete)
 * **LOC**: ~2,177 lines (across all session components)
 *
 * **Architecture**:
 * - Pure presentation components with signal-based APIs
 * - OnPush change detection for performance
 * - VS Code native styling integration
 * - Inline templates and styles
 */

// Components
export * from './lib/components';

// Containers
export * from './lib/containers';

// Re-export types
export type { SessionAction } from './lib/components';

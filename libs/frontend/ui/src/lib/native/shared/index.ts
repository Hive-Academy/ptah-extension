/**
 * Native Shared Services - Barrel Export
 *
 * Foundation services for native overlay components.
 * These services replace CDK Overlay and CDK A11y with lightweight alternatives.
 *
 * @module native/shared
 */
export {
  FloatingUIService,
  type FloatingUIOptions,
} from './floating-ui.service';
export {
  KeyboardNavigationService,
  type KeyboardNavigationConfig,
} from './keyboard-navigation.service';
export {
  DEFAULT_OVERLAY_OFFSET,
  AUTOCOMPLETE_OVERLAY_OFFSET,
} from './floating-offsets';

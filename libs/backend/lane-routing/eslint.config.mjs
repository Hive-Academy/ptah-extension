import baseConfig from '../../../eslint.config.mjs';

/**
 * Same spread as a sibling backend lib. skill-synthesis adds restricted
 * selectors for its own tier-mutation hazard; those names are not a boundary
 * of this library. Workspace `no-restricted-syntax` still applies because
 * this file does not replace that rule.
 */
export default [...baseConfig];

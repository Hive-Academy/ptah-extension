import nx from '@nx/eslint-plugin';
import baseConfig from '../../eslint.config.mjs';
import angularConfig from '../../eslint.angular.config.mjs';

export default [
  ...baseConfig,
  ...nx.configs['flat/angular'],
  ...nx.configs['flat/angular-template'],
  // Shared with the libs/web/* domains extracted out of this app so both sides
  // lint under identical rules. See eslint.angular.config.mjs — moving a file
  // into a lib must not change its lint posture.
  ...angularConfig,
];

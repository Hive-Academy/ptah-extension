import { setupZoneTestEnv } from 'jest-preset-angular/setup-env/zone';
import { registerMatchers } from '@ptah-extension/shared/testing';

setupZoneTestEnv({
  errorOnUnknownElements: true,
  errorOnUnknownProperties: true,
});

registerMatchers();

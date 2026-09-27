import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { markAppStable } from './app/i18n/app-stable-marker';

bootstrapApplication(App, appConfig)
  .then((appRef) => markAppStable(appRef, document))
  .catch((err) => console.error(err));

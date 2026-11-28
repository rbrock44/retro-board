import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { captureUnlockLink } from './app/core/unlock-link';

captureUnlockLink();

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));

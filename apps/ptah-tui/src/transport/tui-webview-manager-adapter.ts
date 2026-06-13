import { CliWebviewManagerAdapter } from '@ptah-extension/cli-engine';

export class TuiWebviewManagerAdapter extends CliWebviewManagerAdapter {
  constructor() {
    super();
    this.setMaxListeners(64);
  }
}

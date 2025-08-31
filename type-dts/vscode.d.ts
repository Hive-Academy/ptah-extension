// VS Code Webview API declarations
declare function acquireVsCodeApi(): {
  postMessage(message: any): void;
  getState(): any;
  setState(state: any): void;
};

interface Window {
  ptahConfig?: {
    isVSCode: boolean;
    theme: 'light' | 'dark';
    workspaceRoot: string;
  };
}

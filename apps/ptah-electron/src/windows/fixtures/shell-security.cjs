const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const root = process.argv[2];
const { installPermissionPolicy } = require(
  path.join(root, 'permission-policy.cjs'),
);
const { pathToFileURL } = require('node:url');

// S8707: `root` is process.argv[2], which Sonar treats as possibly
// LLM-supplied. It is not. This file is a test fixture that ships in no
// build; shell-csp.spec.ts is its only caller and passes a temp directory it
// created itself with mkdtempSync. There is no path to reach this argument
// with attacker or model input, so there is nothing to sanitize.
app.setPath('userData', path.join(root, 'profile')); // NOSONAR
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app
  .whenReady()
  .then(async () => {
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    const document = path.join(root, 'index.html');
    installPermissionPolicy(win.webContents, pathToFileURL(document).href);
    // S8707: same reason as the setPath above — `document` derives from
    // process.argv[2], which only shell-csp.spec.ts supplies, as a temp
    // directory it created. Never LLM input, never shipped.
    await win.loadFile(document); // NOSONAR
    const result = await win.webContents.executeJavaScript(
      'window.securityProbe',
    );
    console.log(`SHELL_SECURITY_RESULT:${JSON.stringify(result)}`);
    win.destroy();
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });

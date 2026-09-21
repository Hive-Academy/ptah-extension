const { app, BrowserWindow } = require('electron');
const path = require('node:path');
// The spec copies this entrypoint beside its generated assets. No CLI path
// can redirect the profile, policy module, or document outside that fixture.
const root = __dirname;
const { installPermissionPolicy } = require(
  path.join(root, 'permission-policy.cjs'),
);
const { pathToFileURL } = require('node:url');

app.setPath('userData', path.join(root, 'profile'));
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
    await win.loadFile(document);
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

import * as vscode from 'vscode';

/**
 * Diagnostic tool for webview issues
 */
export class WebviewDiagnostic {
  /**
   * Create a simple diagnostic webview to test if webviews work at all
   */
  static createDiagnosticWebview(context: vscode.ExtensionContext): vscode.WebviewPanel {
    const panel = vscode.window.createWebviewPanel(
      'ptahDiagnostic',
      'Ptah Diagnostic',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    panel.webview.html = this.getDiagnosticHtml(panel.webview, context);

    // Handle messages from diagnostic webview
    panel.webview.onDidReceiveMessage((message) => {
      switch (message.type) {
        case 'diagnostic-ready':
          vscode.window.showInformationMessage('Diagnostic webview is working!');
          break;
        case 'test-complete':
          vscode.window.showInformationMessage(`Diagnostic test complete: ${message.status}`);
          break;
      }
    });

    return panel;
  }

  private static getDiagnosticHtml(
    webview: vscode.Webview,
    context: vscode.ExtensionContext
  ): string {
    const nonce = this.generateNonce();

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}' 'unsafe-inline';">
        <title>Ptah Diagnostic</title>
        <style nonce="${nonce}">
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 20px;
            background: var(--vscode-editor-background);
            color: var(--vscode-foreground);
          }
          .test {
            margin: 10px 0;
            padding: 10px;
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
          }
          .pass { background: rgba(0, 255, 0, 0.1); }
          .fail { background: rgba(255, 0, 0, 0.1); }
          button {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            cursor: pointer;
            border-radius: 3px;
          }
        </style>
      </head>
      <body>
        <h1>Ptah Webview Diagnostic</h1>
        
        <div id="tests">
          <div class="test">
            <h3>1. VS Code API Test</h3>
            <p id="vscode-api-test">Testing...</p>
          </div>
          
          <div class="test">
            <h3>2. Resource Loading Test</h3>
            <p id="resource-test">Testing...</p>
          </div>
          
          <div class="test">
            <h3>3. Angular Build Files Test</h3>
            <p id="angular-files-test">Testing...</p>
          </div>
          
          <div class="test">
            <h3>4. Network Test</h3>
            <p id="network-test">Testing...</p>
          </div>
        </div>

        <button onclick="runTests()">Run All Tests</button>
        <button onclick="testAngularLoad()">Test Angular Load</button>

        <script nonce="${nonce}">
          const vscode = acquireVsCodeApi();

          function log(message) {
            console.log(message);
          }

          function updateTest(id, status, message) {
            const element = document.getElementById(id);
            element.textContent = message;
            element.parentElement.className = 'test ' + status;
          }

          function runTests() {
            log('Running diagnostic tests...');

            // Test 1: VS Code API
            try {
              if (typeof vscode !== 'undefined' && vscode.postMessage) {
                updateTest('vscode-api-test', 'pass', 'VS Code API is available');
                vscode.postMessage({ type: 'diagnostic-ready' });
              } else {
                updateTest('vscode-api-test', 'fail', 'VS Code API not available');
              }
            } catch (error) {
              updateTest('vscode-api-test', 'fail', 'Error: ' + error.message);
            }

            // Test 2: Resource access
            try {
              const baseUri = '${webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'out', 'webview', 'browser'))}';
              updateTest('resource-test', 'pass', 'Base URI: ' + baseUri);
            } catch (error) {
              updateTest('resource-test', 'fail', 'Error: ' + error.message);
            }

            // Test 3: Angular files
            testAngularFiles();

            // Test 4: Network
            testNetwork();
          }

          function testAngularFiles() {
            const baseUri = '${webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'out', 'webview', 'browser'))}';
            
            // Test if main.js exists
            fetch(baseUri + '/main.js')
              .then(response => {
                if (response.ok) {
                  updateTest('angular-files-test', 'pass', 'main.js is accessible');
                } else {
                  updateTest('angular-files-test', 'fail', 'main.js not found (status: ' + response.status + ')');
                }
              })
              .catch(error => {
                updateTest('angular-files-test', 'fail', 'Error loading main.js: ' + error.message);
              });
          }

          function testNetwork() {
            // Simple connectivity test
            try {
              fetch('data:text/plain,test')
                .then(() => updateTest('network-test', 'pass', 'Basic fetch working'))
                .catch(error => updateTest('network-test', 'fail', 'Fetch error: ' + error.message));
            } catch (error) {
              updateTest('network-test', 'fail', 'Network error: ' + error.message);
            }
          }

          function testAngularLoad() {
            log('Testing Angular app load...');
            
            const baseUri = '${webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'out', 'webview', 'browser'))}';
            
            // Create iframe to test Angular app
            const iframe = document.createElement('iframe');
            iframe.src = baseUri + '/index.html';
            iframe.style.width = '100%';
            iframe.style.height = '400px';
            iframe.style.border = '1px solid var(--vscode-input-border)';
            
            iframe.onload = () => {
              log('Angular iframe loaded successfully');
            };
            
            iframe.onerror = (error) => {
              log('Angular iframe failed to load: ' + error);
            };
            
            document.body.appendChild(iframe);
          }

          // Auto-run tests on load
          window.addEventListener('load', () => {
            setTimeout(runTests, 100);
          });
        </script>
      </body>
      </html>
    `;
  }

  private static generateNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}

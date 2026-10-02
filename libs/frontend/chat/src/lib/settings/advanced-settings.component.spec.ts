import { ChangeDetectionStrategy, Component, output } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import {
  createMockRpcService,
  rpcError,
  rpcSuccess,
  type MockRpcService,
} from '@ptah-extension/core/testing';
import { AdvancedSettingsComponent } from './advanced-settings.component';
import { LicenseStatusCardComponent } from './license/license-status-card.component';
import { VscodeLmConfigComponent } from './pro-features/vscode-lm-config.component';
import { McpPortConfigComponent } from './pro-features/mcp-port-config.component';
import { AgentBehaviourSectionComponent } from './pro-features/agent-behaviour-section.component';
import { OutputStyleConfigComponent } from './output-style/output-style-config.component';

@Component({ selector: 'ptah-license-status-card', standalone: true,
  // Projects the shell's Export/Import slots the way the real card does.
  changeDetection: ChangeDetectionStrategy.OnPush, template: '<ng-content />' })
class LicenseStub {}

@Component({ selector: 'ptah-output-style-config', standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush, template: '<p>Output style</p>' })
class OutputStyleStub {}

@Component({ selector: 'ptah-agent-behaviour-section', standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush, template: '<p>Agent behaviour</p>' })
class AgentBehaviourStub {}

@Component({ selector: 'ptah-mcp-port-config', standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush, template: '<p>MCP port</p>' })
class McpPortStub {}

@Component({ selector: 'ptah-vscode-lm-config', standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush, template: '<p>VS Code LM</p>' })
class VsCodeLmStub {
  readonly modelChanged = output<void>();
}

describe('AdvancedSettingsComponent', () => {
  let fixture: ComponentFixture<AdvancedSettingsComponent>;
  let element: HTMLElement;
  let rpc: MockRpcService;

  beforeEach(() => { rpc = createMockRpcService(); });
  afterEach(() => { fixture?.destroy(); TestBed.resetTestingModule(); });

  /** Configures a fresh module for the given host and renders the shell. */
  async function render(isElectron: boolean): Promise<void> {
    TestBed.configureTestingModule({
      imports: [AdvancedSettingsComponent],
      providers: [
        { provide: ClaudeRpcService, useValue: rpc },
        { provide: VSCodeService, useValue: { isElectron } },
      ],
    }).overrideComponent(AdvancedSettingsComponent, {
      remove: { imports: [LicenseStatusCardComponent, AgentBehaviourSectionComponent, OutputStyleConfigComponent, McpPortConfigComponent, VscodeLmConfigComponent] },
      add: { imports: [LicenseStub, AgentBehaviourStub, OutputStyleStub, McpPortStub, VsCodeLmStub] },
    });
    await TestBed.compileComponents();
    fixture = TestBed.createComponent(AdvancedSettingsComponent);
    element = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const lm = () => fixture.debugElement.query(By.directive(VsCodeLmStub)).injector.get(VsCodeLmStub);

  /** Clicks Import, then the inline confirm's "Import settings" button (S-confirm). */
  async function confirmImport(): Promise<void> {
    element.querySelector<HTMLButtonElement>('[aria-label="Import settings"]')?.click();
    fixture.detectChanges();
    element.querySelector<HTMLButtonElement>('[data-testid="import-confirm-button"]')?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('mounts the section cards in order, with Agent behaviour replacing workflows-config and enhanced-prompts deleted (D14)', async () => {
    await render(false);
    expect(element.querySelector('ptah-workflows-config')).toBeNull();
    expect(element.querySelector('ptah-enhanced-prompts-config')).toBeNull();
    const selectors = [
      'ptah-license-status-card',
      'ptah-agent-behaviour-section',
      'ptah-output-style-config',
      'ptah-mcp-port-config',
      'ptah-vscode-lm-config',
    ];
    const nodes = selectors.map((selector) => element.querySelector(selector));
    expect(nodes.every(Boolean)).toBe(true);
    for (let i = 0; i < nodes.length - 1; i += 1) {
      expect(nodes[i]?.compareDocumentPosition(nodes[i + 1] as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
  });

  it('keeps the Export settings aria-label and calls ptah.exportSettings in VS Code', async () => {
    await render(false);
    const exportBtn = element.querySelector<HTMLButtonElement>('[aria-label="Export settings"]');
    expect(exportBtn).not.toBeNull();
    exportBtn?.click();
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(rpc.call).toHaveBeenCalledWith('command:execute', { command: 'ptah.exportSettings' });
  });

  it('keeps the Import settings aria-label and confirms before calling ptah.importSettings in VS Code', async () => {
    await render(false);
    const importBtn = element.querySelector<HTMLButtonElement>('[aria-label="Import settings"]');
    expect(importBtn).not.toBeNull();
    importBtn?.click();
    fixture.detectChanges();
    // S-confirm: the inline confirm opens and nothing is written yet.
    expect(element.querySelector('[data-testid="import-confirm"]')).not.toBeNull();
    expect(rpc.call).not.toHaveBeenCalled();
    await confirmImport();
    expect(rpc.call).toHaveBeenCalledWith('command:execute', { command: 'ptah.importSettings' });
  });

  it('does not call the import RPC when the confirm is cancelled', async () => {
    await render(false);
    element.querySelector<HTMLButtonElement>('[aria-label="Import settings"]')?.click();
    fixture.detectChanges();
    const cancel = Array.from(element.querySelectorAll<HTMLButtonElement>('[data-testid="import-confirm"] button'))
      .find((button) => button.textContent?.trim() === 'Cancel');
    cancel?.click();
    fixture.detectChanges();
    expect(rpc.call).not.toHaveBeenCalled();
    expect(element.querySelector('[data-testid="import-confirm"]')).toBeNull();
  });

  it('opens the import confirm with Cancel focused; Esc cancels, returns focus to Import and stops there (Batch 49b)', async () => {
    await render(false);
    document.body.appendChild(element);
    const outer = jest.fn();
    document.body.addEventListener('keydown', outer);
    try {
      const importButton = element.querySelector<HTMLButtonElement>('[aria-label="Import settings"]');
      importButton?.click();
      fixture.detectChanges();
      fixture.detectChanges();
      expect(document.activeElement?.textContent?.trim()).toBe('Cancel');

      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      fixture.detectChanges();
      await fixture.whenStable();

      expect(element.querySelector('[data-testid="import-confirm"]')).toBeNull();
      expect(document.activeElement).toBe(importButton);
      expect(outer).not.toHaveBeenCalled();
      expect(rpc.call).not.toHaveBeenCalled();
    } finally {
      document.body.removeEventListener('keydown', outer);
      element.remove();
    }
  });

  it('surfaces an Electron import result with errors as an inline alert without leaking host error text', async () => {
    rpc.call.mockResolvedValue(rpcSuccess({ cancelled: false, result: { imported: [], skipped: [], errors: ['secrets:boom: host detail'] } }));
    await render(true);
    await confirmImport();
    expect(rpc.call).toHaveBeenCalledWith('settings:import', {});
    const outcome = element.querySelector('[data-testid="import-outcome"]');
    expect(outcome?.getAttribute('role')).toBe('alert');
    expect(outcome?.textContent).toContain('Some settings could not be imported.');
    expect(outcome?.textContent).not.toContain('secrets:boom');
    expect(outcome?.textContent).not.toContain('host detail');
  });

  it('shows the import outcome only from the write result on Electron success', async () => {
    rpc.call.mockResolvedValue(rpcSuccess({ cancelled: false, result: { imported: ['config:a'], skipped: [], errors: [] } }));
    await render(true);
    await confirmImport();
    const outcome = element.querySelector('[data-testid="import-outcome"]');
    expect(outcome?.getAttribute('role')).toBe('status');
    expect(outcome?.textContent).toContain('Settings imported.');
  });

  it('stays silent when the Electron file dialog is cancelled', async () => {
    rpc.call.mockResolvedValue(rpcSuccess({ cancelled: true }));
    await render(true);
    await confirmImport();
    expect(element.querySelector('[data-testid="import-outcome"]')).toBeNull();
  });

  it('surfaces an Electron import RPC error as an inline alert without leaking host error text', async () => {
    rpc.call.mockResolvedValue(rpcError('import handler missing: internal details'));
    await render(true);
    await confirmImport();
    const outcome = element.querySelector('[data-testid="import-outcome"]');
    expect(outcome?.getAttribute('role')).toBe('alert');
    expect(outcome?.textContent).toContain('Could not import the settings.');
    expect(outcome?.textContent).not.toContain('import handler missing');
  });

  it('surfaces a VS Code import execution error as an inline alert without leaking host error text', async () => {
    rpc.call.mockResolvedValue(rpcError('command execution failed: internal details'));
    await render(false);
    await confirmImport();
    const outcome = element.querySelector('[data-testid="import-outcome"]');
    expect(outcome?.getAttribute('role')).toBe('alert');
    expect(outcome?.textContent).toContain('Could not import the settings.');
    expect(outcome?.textContent).not.toContain('command execution failed');
  });

  it('surfaces a thrown import exception as an inline alert without leaking Error message', async () => {
    rpc.call.mockRejectedValue(new Error('connection reset: internal details'));
    await render(true);
    await confirmImport();
    const outcome = element.querySelector('[data-testid="import-outcome"]');
    expect(outcome?.getAttribute('role')).toBe('alert');
    expect(outcome?.textContent).toContain('Could not import the settings.');
    expect(outcome?.textContent).not.toContain('connection reset');
  });

  it('uses settings:export/settings:import in Electron', async () => {
    rpc.call.mockResolvedValue(rpcSuccess({ cancelled: false, result: { imported: [], skipped: [], errors: [] } }));
    await render(true);
    element.querySelector<HTMLButtonElement>('[aria-label="Export settings"]')?.click();
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    await confirmImport();
    expect(rpc.call).toHaveBeenCalledWith('settings:export', {});
    expect(rpc.call).toHaveBeenCalledWith('settings:import', {});
  });

  it('forwards the VS Code LM modelChanged event', async () => {
    await render(false);
    const emitted: void[] = [];
    fixture.componentInstance.modelChanged.subscribe(() => emitted.push(undefined));
    lm().modelChanged.emit();
    expect(emitted.length).toBe(1);
  });

  it('disables the export button while exporting', async () => {
    let finishExport: () => void = () => void 0;
    rpc.call.mockImplementation(
      () => new Promise((resolve) => { finishExport = () => resolve(rpcSuccess(undefined)); }),
    );
    await render(false);
    const exportBtn = element.querySelector<HTMLButtonElement>('[aria-label="Export settings"]');
    exportBtn?.click();
    fixture.detectChanges();
    expect(exportBtn?.disabled).toBe(true);
    finishExport();
    await fixture.whenStable(); fixture.detectChanges();
    expect(exportBtn?.disabled).toBe(false);
  });
});
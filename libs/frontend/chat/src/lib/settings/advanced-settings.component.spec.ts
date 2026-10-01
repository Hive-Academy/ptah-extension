import { ChangeDetectionStrategy, Component, output } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import { AdvancedSettingsComponent } from './advanced-settings.component';
import { LicenseStatusCardComponent } from './license/license-status-card.component';
import { EnhancedPromptsConfigComponent } from './pro-features/enhanced-prompts-config.component';
import { VscodeLmConfigComponent } from './pro-features/vscode-lm-config.component';
import { McpPortConfigComponent } from './pro-features/mcp-port-config.component';
import { WorkflowsConfigComponent } from './pro-features/workflows-config.component';
import { OutputStyleConfigComponent } from './output-style/output-style-config.component';

@Component({ selector: 'ptah-license-status-card', standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush, template: '<p>License</p>' })
class LicenseStub {}

@Component({ selector: 'ptah-enhanced-prompts-config', standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush, template: '<p>Enhanced prompts</p>' })
class EnhancedPromptsStub {}

@Component({ selector: 'ptah-output-style-config', standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush, template: '<p>Output style</p>' })
class OutputStyleStub {}

@Component({ selector: 'ptah-workflows-config', standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush, template: '<p>Workflows</p>' })
class WorkflowsStub {}

@Component({ selector: 'ptah-mcp-port-config', standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush, template: '<p>MCP port</p>' })
class McpPortStub {}

@Component({ selector: 'ptah-vscode-lm-config', standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush, template: '<p>VS Code LM</p>' })
class VsCodeLmStub {
  readonly modelChanged = output<void>();
}

function rpcStub() {
  return { call: jest.fn().mockResolvedValue(undefined) };
}

describe('AdvancedSettingsComponent', () => {
  let fixture: ComponentFixture<AdvancedSettingsComponent>;
  let element: HTMLElement;
  let rpc: ReturnType<typeof rpcStub>;

  beforeEach(async () => {
    rpc = rpcStub();
    await TestBed.configureTestingModule({
      imports: [AdvancedSettingsComponent],
      providers: [
        { provide: ClaudeRpcService, useValue: rpc },
        { provide: VSCodeService, useValue: { isElectron: false } },
      ],
    }).overrideComponent(AdvancedSettingsComponent, {
      remove: { imports: [LicenseStatusCardComponent, EnhancedPromptsConfigComponent, OutputStyleConfigComponent, WorkflowsConfigComponent, McpPortConfigComponent, VscodeLmConfigComponent] },
      add: { imports: [LicenseStub, EnhancedPromptsStub, OutputStyleStub, WorkflowsStub, McpPortStub, VsCodeLmStub] },
    }).compileComponents();
    fixture = TestBed.createComponent(AdvancedSettingsComponent);
    element = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => { fixture.destroy(); TestBed.resetTestingModule(); });

  async function render() { fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); }
  const lm = () => fixture.debugElement.query(By.directive(VsCodeLmStub)).injector.get(VsCodeLmStub);

  it('mounts the existing children in order', async () => {
    await render();
    const selectors = [
      'ptah-license-status-card',
      'ptah-enhanced-prompts-config',
      'ptah-output-style-config',
      'ptah-workflows-config',
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
    await render();
    const exportBtn = element.querySelector<HTMLButtonElement>('[aria-label="Export settings"]');
    expect(exportBtn).not.toBeNull();
    exportBtn?.click(); await render();
    expect(rpc.call).toHaveBeenCalledWith('command:execute', { command: 'ptah.exportSettings' });
  });

  it('keeps the Import settings aria-label and calls ptah.importSettings in VS Code', async () => {
    await render();
    const importBtn = element.querySelector<HTMLButtonElement>('[aria-label="Import settings"]');
    expect(importBtn).not.toBeNull();
    importBtn?.click(); await render();
    expect(rpc.call).toHaveBeenCalledWith('command:execute', { command: 'ptah.importSettings' });
  });

  it('uses settings:export/settings:import in Electron', async () => {
    TestBed.resetTestingModule();
    rpc = rpcStub();
    await TestBed.configureTestingModule({
      imports: [AdvancedSettingsComponent],
      providers: [
        { provide: ClaudeRpcService, useValue: rpc },
        { provide: VSCodeService, useValue: { isElectron: true } },
      ],
    }).overrideComponent(AdvancedSettingsComponent, {
      remove: { imports: [LicenseStatusCardComponent, EnhancedPromptsConfigComponent, OutputStyleConfigComponent, WorkflowsConfigComponent, McpPortConfigComponent, VscodeLmConfigComponent] },
      add: { imports: [LicenseStub, EnhancedPromptsStub, OutputStyleStub, WorkflowsStub, McpPortStub, VsCodeLmStub] },
    }).compileComponents();
    fixture = TestBed.createComponent(AdvancedSettingsComponent);
    element = fixture.nativeElement as HTMLElement;
    await render();
    element.querySelector<HTMLButtonElement>('[aria-label="Export settings"]')?.click(); await render();
    element.querySelector<HTMLButtonElement>('[aria-label="Import settings"]')?.click(); await render();
    expect(rpc.call).toHaveBeenCalledWith('settings:export' as never, {} as never);
    expect(rpc.call).toHaveBeenCalledWith('settings:import' as never, {} as never);
  });

  it('forwards the VS Code LM modelChanged event', async () => {
    await render();
    const emitted: void[] = [];
    fixture.componentInstance.modelChanged.subscribe(() => emitted.push(undefined));
    lm().modelChanged.emit();
    expect(emitted.length).toBe(1);
  });

  it('disables the export button while exporting', async () => {
    let finishExport: () => void = () => {};
    rpc.call.mockImplementation(() => new Promise<void>((resolve) => { finishExport = () => resolve(); }));
    await render();
    const exportBtn = element.querySelector<HTMLButtonElement>('[aria-label="Export settings"]');
    exportBtn?.click(); await render();
    expect(exportBtn?.disabled).toBe(true);
    finishExport(); await render();
    expect(exportBtn?.disabled).toBe(false);
  });
});

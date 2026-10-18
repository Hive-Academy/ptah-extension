import { TestBed } from '@angular/core/testing';
import { McpServerListComponent } from './mcp-server-list.component';
import { type McpServerRow } from './mcp-server-status.service';

describe('McpServerListComponent', () => {
  const rows: readonly McpServerRow[] = [
    { key: 'live', label: 'Live server', status: 'connected', statusLabel: 'Connected', needsAction: false, hint: 'Managed by Smithery' },
    { key: 'auth', label: 'Auth server', status: 'needs-auth', statusLabel: 'Needs authorization', needsAction: true, hint: null },
  ];

  it('renders names, hints, badges and emits the selected Authorize row', () => {
    TestBed.configureTestingModule({ imports: [McpServerListComponent] });
    const fixture = TestBed.createComponent(McpServerListComponent);
    fixture.componentRef.setInput('rows', rows);
    const authorize = jest.fn();
    fixture.componentInstance.authorize.subscribe(authorize);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('Live server');
    expect(host.textContent).toContain('Managed by Smithery');
    expect(host.textContent).toContain('Connected');
    expect(host.textContent).toContain('Needs authorization');
    expect(host.querySelectorAll('button')).toHaveLength(1);
    host.querySelector('button')?.click();
    expect(authorize).toHaveBeenCalledWith(rows[1]);
  });

  it('preserves the empty message and notice action', () => {
    TestBed.configureTestingModule({ imports: [McpServerListComponent] });
    const fixture = TestBed.createComponent(McpServerListComponent);
    fixture.componentRef.setInput('rows', []);
    fixture.componentRef.setInput('notices', [{ code: 'claude-ai-connectors-disabled', message: 'disabled' }]);
    fixture.componentRef.setInput('providerLabel', 'OpenAI Codex');
    const settings = jest.fn();
    fixture.componentInstance.providerSettings.subscribe(settings);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('This session reports no MCP servers.');
    expect(host.textContent).toContain('OpenAI Codex');
    host.querySelector('button')?.click();
    expect(settings).toHaveBeenCalledTimes(1);
  });
});

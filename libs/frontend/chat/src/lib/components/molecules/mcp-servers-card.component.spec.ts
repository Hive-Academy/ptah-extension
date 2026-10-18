import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AppStateManager, ClaudeRpcService } from '@ptah-extension/core';
import { SessionMcpStatusRegistry, TabManagerService } from '@ptah-extension/chat-state';
import { ChatStore } from '../../services/chat.store';
import { McpServersCardComponent } from './mcp-servers-card.component';

describe('McpServersCardComponent', () => {
  const activeTabId = signal<string | null>('tab-1');
  const currentSessionId = signal<string | null>(null);
  const rpc = { call: jest.fn().mockResolvedValue({ isSuccess: () => true, data: { servers: [] } }) };
  const appState = { openMarketplace: jest.fn(), setCurrentView: jest.fn() };

  beforeEach(() => {
    activeTabId.set('tab-1');
    currentSessionId.set(null);
    rpc.call.mockClear();
    TestBed.configureTestingModule({
      imports: [McpServersCardComponent],
      providers: [
        { provide: TabManagerService, useValue: { activeTabId } },
        { provide: ChatStore, useValue: { currentSessionId } },
        { provide: ClaudeRpcService, useValue: rpc },
        { provide: AppStateManager, useValue: appState },
      ],
    });
  });

  it('hides with no data, then shows a collapsed count and toggles its list', () => {
    const registry = TestBed.inject(SessionMcpStatusRegistry);
    const fixture = TestBed.createComponent(McpServersCardComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('section')).toBeNull();

    registry.record('tab-1', { servers: [
      { name: 'live', status: 'connected' },
      { name: 'auth', status: 'needs-auth' },
    ], notices: [] });
    fixture.detectChanges();
    const button = host.querySelector('section > button') as HTMLButtonElement;
    expect(button.textContent).toContain('MCP servers');
    expect(button.textContent).toContain('1/2');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(host.textContent).not.toContain('Live server');

    button.click();
    fixture.detectChanges();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(host.textContent).toContain('live');
    expect(host.textContent).toContain('Needs authorization');
    button.click();
    fixture.detectChanges();
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('follows the active tab and remains visible for a notice-only status', () => {
    const registry = TestBed.inject(SessionMcpStatusRegistry);
    registry.record('tab-2', { servers: [], notices: [
      { code: 'capability-policy-unverified', message: 'Policy unavailable' },
    ] });
    const fixture = TestBed.createComponent(McpServersCardComponent);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('section')).toBeNull();
    activeTabId.set('tab-2');
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('0/0');
    (host.querySelector('section > button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(host.textContent).toContain('Policy unavailable');
  });
});

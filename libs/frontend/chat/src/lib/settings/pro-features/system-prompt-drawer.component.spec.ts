import { Component, Input, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import { rpcError, rpcSuccess } from '@ptah-extension/core/testing';
import { Download, RotateCw } from 'lucide-angular';
import { MarkdownBlockComponent } from '@ptah-extension/markdown';
import type { EnhancedPromptsGetStatusResponse } from '@ptah-extension/shared';
import { SystemPromptDrawerComponent } from './system-prompt-drawer.component';

@Component({
  selector: 'ptah-markdown-block',
  standalone: true,
  template: '<div data-testid="markdown-stub">{{ content }}</div>',
})
class MarkdownBlockStubComponent {
  @Input() content = '';
}

@Component({
  standalone: true,
  imports: [SystemPromptDrawerComponent],
  template: `
    <ptah-system-prompt-drawer
      [isOpen]="isOpen()"
      (closed)="onClosed()"
      (changed)="onChanged()"
    />
  `,
})
class TestHostComponent {
  readonly isOpen = signal(true);
  closedCalled = false;
  changedCalled = false;

  onClosed(): void {
    this.closedCalled = true;
  }

  onChanged(): void {
    this.changedCalled = true;
  }
}

describe('SystemPromptDrawerComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let host: TestHostComponent;
  let element: HTMLElement;
  let call: jest.Mock;

  const defaultStatus: EnhancedPromptsGetStatusResponse = {
    enabled: true,
    hasGeneratedPrompt: true,
    generatedAt: '2026-10-01T12:00:00.000Z',
    detectedStack: {
      frameworks: ['Angular', 'NestJS'],
      languages: ['TypeScript'],
      projectType: 'Monorepo',
    },
  };

  async function render(
    status: EnhancedPromptsGetStatusResponse = defaultStatus,
    statusError?: string,
  ): Promise<void> {
    call = jest.fn(async (method: string) => {
      if (method === 'enhancedPrompts:getStatus') {
        return statusError ? rpcError(statusError) : rpcSuccess(status);
      }
      if (method === 'enhancedPrompts:getPromptContent') {
        return rpcSuccess({ content: '# Project Instructions\n\nFollow these rules.' });
      }
      if (method === 'enhancedPrompts:regenerate') {
        return rpcSuccess({ success: true, enabled: true, hasGeneratedPrompt: true });
      }
      if (method === 'enhancedPrompts:download') {
        return rpcSuccess({ success: true, filePath: '/path/to/prompt.md' });
      }
      return rpcSuccess(undefined);
    });

    TestBed.configureTestingModule({
      imports: [TestHostComponent],
      providers: [{ provide: ClaudeRpcService, useValue: { call } }],
    }).overrideComponent(SystemPromptDrawerComponent, {
      remove: { imports: [MarkdownBlockComponent] },
      add: { imports: [MarkdownBlockStubComponent] },
    });

    fixture = TestBed.createComponent(TestHostComponent);
    host = fixture.componentInstance;
    element = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  afterEach(() => {
    fixture?.destroy();
    TestBed.resetTestingModule();
  });

  describe('initial render and metadata (A14)', () => {
    it('loads status and renders generated-at timestamp and detected stack', async () => {
      await render();
      expect(call).toHaveBeenCalledWith('enhancedPrompts:getStatus', { workspacePath: '.' });

      const title = element.querySelector('[data-testid="system-prompt-drawer-title"]');
      expect(title?.textContent?.trim()).toBe('System prompt');

      const generatedAt = element.querySelector('[data-testid="system-prompt-generated-at"]');
      expect(generatedAt).not.toBeNull();
      expect(generatedAt?.textContent).toContain('Generated:');

      const stack = element.querySelector('[data-testid="system-prompt-detected-stack"]');
      expect(stack).not.toBeNull();
      expect(stack?.textContent).toContain('Angular, NestJS');
      expect(stack?.textContent).toContain('TypeScript');
      expect(stack?.textContent).toContain('Monorepo');
    });

    it('renders error alert when status loading fails', async () => {
      await render(defaultStatus, 'Failed to read config');

      const error = element.querySelector('[data-testid="system-prompt-drawer-error"]');
      expect(error).not.toBeNull();
      expect(error?.textContent).toContain('Could not load the system prompt status.');
      expect(error?.textContent).not.toContain('Failed to read config');
    });
  });

  describe('empty state (A18)', () => {
    it('renders empty-state guidance and disables action buttons when no prompt generated', async () => {
      await render({ enabled: false, hasGeneratedPrompt: false });

      const emptyState = element.querySelector('[data-testid="system-prompt-empty-state"]');
      expect(emptyState).not.toBeNull();
      expect(emptyState?.textContent).toContain(
        'Run the Setup Wizard to generate an AI-enhanced system prompt tailored to your project.',
      );

      const regenerateBtn = element.querySelector<HTMLButtonElement>(
        '[data-testid="system-prompt-regenerate-button"]',
      );
      const downloadBtn = element.querySelector<HTMLButtonElement>(
        '[data-testid="system-prompt-download-button"]',
      );
      expect(regenerateBtn?.disabled).toBe(true);
      expect(downloadBtn?.disabled).toBe(true);
    });
  });

  describe('prompt content preview (A17)', () => {
    it('toggles preview and displays content through markdown block', async () => {
      await render();

      const toggleBtn = element.querySelector<HTMLButtonElement>(
        '[data-testid="system-prompt-preview-toggle"]',
      );
      expect(toggleBtn).not.toBeNull();
      expect(toggleBtn?.textContent).toContain('View Generated Prompt');

      // Click to expand preview
      toggleBtn?.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(call).toHaveBeenCalledWith('enhancedPrompts:getPromptContent', { workspacePath: '.' });
      expect(toggleBtn?.textContent).toContain('Hide Generated Prompt');

      const markdownBlock = element.querySelector('[data-testid="system-prompt-markdown-preview"]');
      expect(markdownBlock).not.toBeNull();
      expect(markdownBlock?.textContent).toContain('Project Instructions');

      // Click to collapse preview
      toggleBtn?.click();
      fixture.detectChanges();
      expect(element.querySelector('[data-testid="system-prompt-markdown-preview"]')).toBeNull();
      expect(toggleBtn?.textContent).toContain('View Generated Prompt');
    });

    it('shows fixed error alert when preview loading fails (F1)', async () => {
      await render();

      call.mockImplementation(async (method: string) => {
        if (method === 'enhancedPrompts:getStatus') return rpcSuccess(defaultStatus);
        if (method === 'enhancedPrompts:getPromptContent') {
          return rpcError('Disk error reading prompt file');
        }
        return rpcSuccess(undefined);
      });

      const toggleBtn = element.querySelector<HTMLButtonElement>(
        '[data-testid="system-prompt-preview-toggle"]',
      );
      toggleBtn?.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const error = element.querySelector('[data-testid="system-prompt-drawer-error"]');
      expect(error).not.toBeNull();
      expect(error?.textContent).toContain('Could not load the prompt preview.');
      expect(error?.textContent).not.toContain('Disk error');
    });
  });

  describe('regenerate flow (A15, S-confirm)', () => {
    it('requires confirmation before triggering regenerate RPC', async () => {
      await render();

      const regenerateBtn = element.querySelector<HTMLButtonElement>(
        '[data-testid="system-prompt-regenerate-button"]',
      );
      regenerateBtn?.click();
      fixture.detectChanges();

      // Inline confirm block opens, RPC not yet called
      const confirmBlock = element.querySelector('[data-testid="regenerate-confirm"]');
      expect(confirmBlock).not.toBeNull();
      expect(call).not.toHaveBeenCalledWith(
        'enhancedPrompts:regenerate',
        expect.anything(),
        expect.anything(),
      );

      // Cancel button dismisses confirm block
      const cancelBtn = element.querySelector<HTMLButtonElement>(
        '[data-testid="regenerate-cancel-button"]',
      );
      cancelBtn?.click();
      fixture.detectChanges();
      expect(element.querySelector('[data-testid="regenerate-confirm"]')).toBeNull();
    });

    it('shows fixed error on {success:false} and does not re-read status (regression, F1)', async () => {
      await render();

      call.mockImplementation(async (method: string) => {
        if (method === 'enhancedPrompts:getStatus') return rpcSuccess(defaultStatus);
        if (method === 'enhancedPrompts:regenerate') {
          return rpcSuccess({ success: false, error: 'Generation failed: no workspace.' });
        }
        return rpcSuccess(undefined);
      });

      // Open confirm
      element.querySelector<HTMLButtonElement>('[data-testid="system-prompt-regenerate-button"]')?.click();
      fixture.detectChanges();

      // Confirm
      call.mockClear();
      element.querySelector<HTMLButtonElement>('[data-testid="regenerate-confirm-button"]')?.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(call).toHaveBeenCalledWith(
        'enhancedPrompts:regenerate',
        { workspacePath: '.', force: true },
        { timeout: 120000 },
      );
      expect(call).not.toHaveBeenCalledWith('enhancedPrompts:getStatus', { workspacePath: '.' });
      expect(host.changedCalled).toBe(false);

      const error = element.querySelector('[data-testid="system-prompt-drawer-error"]');
      expect(error?.textContent).toContain('Could not regenerate the system prompt.');
      expect(error?.textContent).not.toContain('Generation failed: no workspace.');
    });

    it('re-reads status and emits changed on successful regeneration', async () => {
      await render();

      // Open confirm and click confirm
      element.querySelector<HTMLButtonElement>('[data-testid="system-prompt-regenerate-button"]')?.click();
      fixture.detectChanges();

      call.mockClear();
      element.querySelector<HTMLButtonElement>('[data-testid="regenerate-confirm-button"]')?.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(call).toHaveBeenCalledWith(
        'enhancedPrompts:regenerate',
        { workspacePath: '.', force: true },
        { timeout: 120000 },
      );
      expect(call).toHaveBeenCalledWith('enhancedPrompts:getStatus', { workspacePath: '.' });
      expect(host.changedCalled).toBe(true);
      expect(element.querySelector('[data-testid="system-prompt-drawer-error"]')).toBeNull();
    });
  });

  describe('download flow (A16, D15 fix, F2)', () => {
    it('surfaces no alert when user cancels the save dialog (F2)', async () => {
      await render();

      call.mockImplementation(async (method: string) => {
        if (method === 'enhancedPrompts:getStatus') return rpcSuccess(defaultStatus);
        if (method === 'enhancedPrompts:download') {
          return rpcSuccess({ success: false, error: 'Save cancelled by user' });
        }
        return rpcSuccess(undefined);
      });

      const downloadBtn = element.querySelector<HTMLButtonElement>(
        '[data-testid="system-prompt-download-button"]',
      );
      downloadBtn?.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const error = element.querySelector('[data-testid="system-prompt-drawer-error"]');
      expect(error).toBeNull();
    });

    it('surfaces alert with fixed error when download returns {success:false} (D15, F1)', async () => {
      await render();

      call.mockImplementation(async (method: string) => {
        if (method === 'enhancedPrompts:getStatus') return rpcSuccess(defaultStatus);
        if (method === 'enhancedPrompts:download') {
          return rpcSuccess({ success: false, error: 'EACCES: permission denied' });
        }
        return rpcSuccess(undefined);
      });

      const downloadBtn = element.querySelector<HTMLButtonElement>(
        '[data-testid="system-prompt-download-button"]',
      );
      downloadBtn?.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const error = element.querySelector('[data-testid="system-prompt-drawer-error"]');
      expect(error).not.toBeNull();
      expect(error?.textContent).toContain('Could not download the system prompt.');
      expect(error?.textContent).not.toContain('EACCES');
    });

    it('surfaces alert with fixed error when download RPC fails (F1)', async () => {
      await render();

      call.mockImplementation(async (method: string) => {
        if (method === 'enhancedPrompts:getStatus') return rpcSuccess(defaultStatus);
        if (method === 'enhancedPrompts:download') {
          return rpcError('Permission denied');
        }
        return rpcSuccess(undefined);
      });

      element.querySelector<HTMLButtonElement>('[data-testid="system-prompt-download-button"]')?.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const error = element.querySelector('[data-testid="system-prompt-drawer-error"]');
      expect(error).not.toBeNull();
      expect(error?.textContent).toContain('Could not download the system prompt.');
      expect(error?.textContent).not.toContain('Permission denied');
    });

    it('succeeds cleanly when download returns {success:true}', async () => {
      await render();

      element.querySelector<HTMLButtonElement>('[data-testid="system-prompt-download-button"]')?.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(call).toHaveBeenCalledWith('enhancedPrompts:download', { workspacePath: '.' });
      expect(element.querySelector('[data-testid="system-prompt-drawer-error"]')).toBeNull();
    });
  });

  describe('drawer close', () => {
    it('emits closed when Close button is clicked', async () => {
      await render();

      const closeBtn = element.querySelector<HTMLButtonElement>(
        '[data-testid="system-prompt-drawer-close"]',
      );
      closeBtn?.click();
      fixture.detectChanges();

      expect(host.closedCalled).toBe(true);
    });
  });

  describe('footer action icons (V1)', () => {
    it('uses RotateCw for Regenerate and Download icon for Download', async () => {
      await render();

      const drawer = fixture.debugElement.children[0]?.componentInstance as SystemPromptDrawerComponent;
      expect(drawer.RotateCwIcon).toBe(RotateCw);
      expect(drawer.DownloadIcon).toBe(Download);

      const regenerateBtn = element.querySelector<HTMLButtonElement>(
        '[data-testid="system-prompt-regenerate-button"]',
      );
      const downloadBtn = element.querySelector<HTMLButtonElement>(
        '[data-testid="system-prompt-download-button"]',
      );
      expect(regenerateBtn?.querySelector('lucide-angular')).not.toBeNull();
      expect(downloadBtn?.querySelector('lucide-angular')).not.toBeNull();
    });
  });
});

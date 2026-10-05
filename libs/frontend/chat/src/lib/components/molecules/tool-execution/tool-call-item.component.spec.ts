import { TestBed } from '@angular/core/testing';
import { FILE_LINK_OPENER } from '@ptah-extension/core';
import { createExecutionNode } from '@ptah-extension/shared';
import { ToolCallItemComponent } from './tool-call-item.component';

describe('ToolCallItemComponent', () => {
  it('keeps the collapsed header text and status icon while using one separator element', async () => {
    await TestBed.configureTestingModule({
      imports: [ToolCallItemComponent],
      providers: [{ provide: FILE_LINK_OPENER, useValue: { open: jest.fn() } }],
    }).compileComponents();

    const fixture = TestBed.createComponent(ToolCallItemComponent);
    fixture.componentRef.setInput(
      'node',
      createExecutionNode({
        id: 'tool-row-1',
        type: 'tool',
        status: 'complete',
        toolName: 'Read',
        toolInput: { file_path: '/workspace/readme.md' },
        toolOutput: 'contents',
      }),
    );
    fixture.detectChanges();

    const row = fixture.nativeElement as HTMLElement;
    expect(row.textContent).toContain('Read');
    expect(row.querySelector('lucide-angular')).not.toBeNull();
    const separator = row.querySelector(':scope > div:last-child') as HTMLElement;
    expect(separator.querySelectorAll('div')).toHaveLength(1);
  });
});

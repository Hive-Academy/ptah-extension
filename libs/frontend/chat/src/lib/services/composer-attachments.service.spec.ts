import { TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import { FilePickerService } from './file-picker.service';
import { ComposerAttachmentsService } from './composer-attachments.service';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lZkAAAAASUVORK5CYII=';
const image = new File([Uint8Array.from(atob(png), (char) => char.charCodeAt(0))], 'image.png', { type: 'image/png' });
const browserFileReader = globalThis.FileReader;

describe('ComposerAttachmentsService', () => {
  let service: ComposerAttachmentsService;
  let call: jest.Mock;
  beforeEach(() => {
    globalThis.FileReader = class {
      result: string | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL(file: File): void {
        const data = file.type === 'image/svg+xml' ? 'PHN2Zy8+' : png;
        this.result = `data:${file.type};base64,${data}`;
        this.onload?.();
      }
    } as unknown as typeof FileReader;
    call = jest.fn();
    TestBed.configureTestingModule({ providers: [
      ComposerAttachmentsService,
      { provide: ClaudeRpcService, useValue: { call } },
      { provide: FilePickerService, useValue: { isFileSupported: () => true } },
    ] });
    service = TestBed.inject(ComposerAttachmentsService);
  });
  afterEach(() => { globalThis.FileReader = browserFileReader; });

  it('pastes and drops supported images, removes and clears them', () => {
    const preventDefault = jest.fn();
    service.onPaste({ clipboardData: { items: [{ type: 'image/png', getAsFile: () => image }] }, preventDefault } as unknown as ClipboardEvent);
    expect(preventDefault).toHaveBeenCalled();
    expect(service.images()).toHaveLength(1);
    const firstId = service.images()[0].id;
    service.onDrop({ dataTransfer: { files: [image] }, preventDefault, stopPropagation: jest.fn() } as unknown as DragEvent);
    expect(service.images()).toHaveLength(2);
    expect(service.toSendOptions().images).toEqual([{ data: png, mediaType: 'image/png' }, { data: png, mediaType: 'image/png' }]);
    service.remove(firstId);
    expect(service.images()).toHaveLength(1);
    service.clear();
    expect(service.images()).toHaveLength(0);
    expect(service.toSendOptions()).toEqual({ files: undefined, images: undefined });
  });

  it('rejects oversized and unsupported images with a visible error', () => {
    const oversized = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'huge.png', { type: 'image/png' });
    service.onDrop({ dataTransfer: { files: [oversized] }, preventDefault: jest.fn(), stopPropagation: jest.fn() } as unknown as DragEvent);
    expect(service.error()).toContain('5MB');
    service.onDrop({ dataTransfer: { files: [new File(['<svg/>'], 'bad.svg', { type: 'image/svg+xml' })] }, preventDefault: jest.fn(), stopPropagation: jest.fn() } as unknown as DragEvent);
    expect(service.images()).toHaveLength(0);
    expect(service.error()).toContain('Unsupported');
  });

  it('lets text drops reach the textarea and reports unsupported files', () => {
    const preventDefault = jest.fn();
    const stopPropagation = jest.fn();
    service.onDrop({ dataTransfer: { files: [], getData: () => 'plain text' }, preventDefault, stopPropagation } as unknown as DragEvent);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(service.error()).toBeNull();
    service.onDrop({ dataTransfer: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] }, preventDefault, stopPropagation } as unknown as DragEvent);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(service.error()).toContain('Unsupported');
    service.onDrop({ dataTransfer: { files: [image] }, preventDefault, stopPropagation } as unknown as DragEvent);
    expect(preventDefault).toHaveBeenCalledTimes(2);
    expect(stopPropagation).toHaveBeenCalledTimes(2);
  });

  it('prevents browser navigation for a non-image file drop', () => {
    const event = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(event, 'dataTransfer', {
      value: { files: [new File(['pdf'], 'notes.pdf', { type: 'application/pdf' })] },
    });
    service.onDrop(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('tracks pending reads and preserves attachments added after the send snapshot', () => {
    let finishRead!: () => void;
    globalThis.FileReader = class {
      result: string | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL(file: File): void {
        finishRead = () => {
          this.result = `data:${file.type};base64,${png}`;
          this.onload?.();
        };
      }
    } as unknown as typeof FileReader;
    service.onPaste({ clipboardData: { items: [{ type: 'image/png', getAsFile: () => image }] }, preventDefault: jest.fn() } as unknown as ClipboardEvent);
    expect(service.pendingReads()).toBe(1);
    expect(service.toSendOptions().images).toBeUndefined();
    finishRead();
    expect(service.pendingReads()).toBe(0);
    service.files.set([{ path: '/ws/first.md', name: 'first.md', size: 12, type: 'text', isLarge: false, tokenEstimate: 3 }]);
    const snapshot = service.snapshotForSend();
    expect(snapshot.options.files).toEqual(['/ws/first.md']);
    service.addFile({ path: '/ws/later.md', name: 'later.md', size: 12, type: 'text', isLarge: false, tokenEstimate: 3 });
    service.images.update((images) => [...images, { ...images[0]!, id: 'later-image' }]);
    snapshot.removeSent();
    expect(service.files().map((file) => file.path)).toEqual(['/ws/later.md']);
    expect(service.images().map((entry) => entry.id)).toEqual(['later-image']);
  });

  it('picks files and images, deduplicates paths, and serializes send options', async () => {
    call.mockResolvedValueOnce({ success: true, data: { files: [{ path: '/ws/brief.md', size: 12 }, { path: '/ws/brief.md', size: 12 }] } });
    call.mockResolvedValueOnce({ success: true, data: { images: [{ name: 'image.png', mediaType: 'image/png', data: png }] } });
    await service.pickFiles();
    await service.pickImages();
    expect(call).toHaveBeenNthCalledWith(1, 'file:pick', { multiple: true });
    expect(call).toHaveBeenNthCalledWith(2, 'file:pick-images', { multiple: true });
    expect(service.files()).toHaveLength(1);
    expect(service.toSendOptions()).toEqual({ files: ['/ws/brief.md'], images: [{ data: png, mediaType: 'image/png' }] });
    service.remove('/ws/brief.md');
    expect(service.files()).toHaveLength(0);
  });
});

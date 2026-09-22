import { TestBed } from '@angular/core/testing';
import { MarkdownService } from 'ngx-markdown';
import { MarkdownBlockComponent } from './markdown-block.component';
import { provideMarkdownRendering } from './provide-markdown-rendering';

describe('markdown surface activity', () => {
  it('holds the latest raw text while hidden and parses/sanitizes it on activation', async () => {
    TestBed.configureTestingModule({
      imports: [MarkdownBlockComponent],
      providers: [...provideMarkdownRendering({ extensions: 'full' })],
    });
    const parse = jest.spyOn(TestBed.inject(MarkdownService), 'parse');
    const fixture = TestBed.createComponent(MarkdownBlockComponent);
    fixture.componentRef.setInput('content', '**before**');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('strong')?.textContent).toBe(
      'before',
    );
    fixture.componentRef.setInput('active', false);
    fixture.detectChanges();
    parse.mockClear();
    fixture.componentRef.setInput('content', '**intermediate**');
    fixture.detectChanges();
    fixture.componentRef.setInput(
      'content',
      '**latest**<img src=x onerror="alert(1)">',
    );
    fixture.detectChanges();
    await fixture.whenStable();
    expect(parse).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('strong')?.textContent).toBe(
      'before',
    );
    fixture.componentRef.setInput('active', true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(parse).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('strong')?.textContent).toBe(
      'latest',
    );
    expect(
      fixture.nativeElement.querySelector('img')?.hasAttribute('onerror'),
    ).toBe(false);
    fixture.detectChanges();
    expect(parse).toHaveBeenCalledTimes(1);
  });
});

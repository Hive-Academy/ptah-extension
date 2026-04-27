import { TestBed } from '@angular/core/testing';
import { Clipboard } from '@angular/cdk/clipboard';
import { CopyButtonComponent } from './copy-button.component';
import type {
  ExecutionChatMessage,
  ExecutionNode,
} from '@ptah-extension/shared';

describe('CopyButtonComponent', () => {
  let copyMock: jest.Mock<boolean, [string]>;

  beforeEach(async () => {
    jest.useFakeTimers();
    copyMock = jest.fn().mockReturnValue(true);

    await TestBed.configureTestingModule({
      imports: [CopyButtonComponent],
      providers: [{ provide: Clipboard, useValue: { copy: copyMock } }],
    }).compileComponents();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function makeUserMessage(content: string): ExecutionChatMessage {
    return {
      id: 'm1',
      role: 'user',
      rawContent: content,
      timestamp: 0,
    } as unknown as ExecutionChatMessage;
  }

  function makeAssistantMessage(
    tree: ExecutionNode | undefined,
  ): ExecutionChatMessage {
    return {
      id: 'm2',
      role: 'assistant',
      streamingState: tree,
      timestamp: 0,
    } as unknown as ExecutionChatMessage;
  }

  function makeNode(partial: Partial<ExecutionNode>): ExecutionNode {
    return {
      id: 'n',
      type: 'text',
      content: '',
      children: [],
      ...partial,
    } as unknown as ExecutionNode;
  }

  it('copies user rawContent on click', () => {
    const fixture = TestBed.createComponent(CopyButtonComponent);
    fixture.componentRef.setInput('message', makeUserMessage('hello'));
    fixture.detectChanges();

    fixture.nativeElement.querySelector('button').click();
    expect(copyMock).toHaveBeenCalledWith('hello');
  });

  it('flips copied flag for 2 seconds after copy', () => {
    const fixture = TestBed.createComponent(CopyButtonComponent);
    fixture.componentRef.setInput('message', makeUserMessage('x'));
    fixture.detectChanges();

    fixture.nativeElement.querySelector('button').click();
    fixture.detectChanges();
    expect(
      (fixture.nativeElement.querySelector('button') as HTMLElement).className,
    ).toContain('text-success');

    jest.advanceTimersByTime(2000);
    fixture.detectChanges();
    expect(
      (fixture.nativeElement.querySelector('button') as HTMLElement).className,
    ).not.toContain('text-success');
  });

  it('extracts text recursively from assistant streamingState tree', () => {
    const tree = makeNode({
      type: 'message',
      content: 'root',
      children: [
        makeNode({ type: 'text', content: 'child-1' }),
        makeNode({
          type: 'message',
          content: 'mid',
          children: [makeNode({ type: 'text', content: 'leaf' })],
        }),
      ],
    });
    const fixture = TestBed.createComponent(CopyButtonComponent);
    fixture.componentRef.setInput('message', makeAssistantMessage(tree));
    fixture.detectChanges();

    fixture.nativeElement.querySelector('button').click();
    expect(copyMock).toHaveBeenCalled();
    const arg = copyMock.mock.calls[0][0];
    expect(arg).toContain('root');
    expect(arg).toContain('child-1');
    expect(arg).toContain('mid');
    expect(arg).toContain('leaf');
  });

  it('warns and skips clipboard when no content', () => {
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const fixture = TestBed.createComponent(CopyButtonComponent);
    fixture.componentRef.setInput('message', makeUserMessage(''));
    fixture.detectChanges();

    fixture.nativeElement.querySelector('button').click();
    expect(copyMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('No content to copy');
    warn.mockRestore();
  });

  it('warns when clipboard.copy fails', () => {
    copyMock.mockReturnValue(false);
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const fixture = TestBed.createComponent(CopyButtonComponent);
    fixture.componentRef.setInput('message', makeUserMessage('x'));
    fixture.detectChanges();

    fixture.nativeElement.querySelector('button').click();
    expect(warn).toHaveBeenCalledWith('Failed to copy to clipboard');
    warn.mockRestore();
  });
});

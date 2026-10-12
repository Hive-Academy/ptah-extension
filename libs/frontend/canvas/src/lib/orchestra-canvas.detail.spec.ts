import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';
jest.mock('gridstack/dist/angular', () => {
  @Component({
    // eslint-disable-next-line @angular-eslint/component-selector
    selector: 'gridstack',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: '<ng-content />',
  })
  class GridstackStub {
    @Input() options: unknown;
    @Output() changeCB = new EventEmitter<unknown>();
    @Output() dragStartCB = new EventEmitter<unknown>();
    @Output() dragCB = new EventEmitter<unknown>();
    @Output() resizeStartCB = new EventEmitter<unknown>();
    @Output() resizeCB = new EventEmitter<unknown>();
    @Output() dragStopCB = new EventEmitter<unknown>();
    @Output() resizeStopCB = new EventEmitter<unknown>();
  }
  @Component({
    // eslint-disable-next-line @angular-eslint/component-selector
    selector: 'gridstack-item',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: '<ng-content />',
  })
  class GridstackItemStub {
    @Input() options: unknown;
  }
  return {
    GridstackComponent: GridstackStub,
    GridstackItemComponent: GridstackItemStub,
  };
});
jest.mock('gridstack', () => ({ GridStack: class {} }));
import { OrchestraCanvasComponent } from './orchestra-canvas.component';

describe('OrchestraCanvasComponent detail keyboard', () => {
  const close = jest.fn();
  const next = jest.fn();
  const prev = jest.fn();
  let open = true;
  const handler = OrchestraCanvasComponent.prototype as unknown as {
    onDetailKeydown(this: unknown, event: KeyboardEvent): void;
  };
  const context = {
    surfaceActive: () => true,
    detailTabId: () => (open ? 'tile-1' : null),
    detail: { close, next, prev },
  };

  beforeEach(() => {
    open = true;
    close.mockClear();
    next.mockClear();
    prev.mockClear();
  });

  it('closes and steps only while detail is open', () => {
    for (const key of ['Escape', 'ArrowRight', 'ArrowLeft']) {
      handler.onDetailKeydown.call(
        context,
        new KeyboardEvent('keydown', { key }),
      );
    }
    expect(close).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
    expect(prev).toHaveBeenCalledTimes(1);
    open = false;
    handler.onDetailKeydown.call(
      context,
      new KeyboardEvent('keydown', { key: 'Escape' }),
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('leaves text inputs and editable content alone', () => {
    const input = document.createElement('input');
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    for (const target of [input, editable]) {
      const event = new KeyboardEvent('keydown', { key: 'ArrowRight' });
      Object.defineProperty(event, 'target', { value: target });
      handler.onDetailKeydown.call(context, event);
    }
    expect(next).not.toHaveBeenCalled();
    const escape = new KeyboardEvent('keydown', { key: 'Escape' });
    Object.defineProperty(escape, 'target', { value: input });
    handler.onDetailKeydown.call(context, escape);
    expect(close).not.toHaveBeenCalled();
  });

  it('ignores hidden canvas, handled events, and lane tabs', () => {
    const tab = document.createElement('button');
    tab.setAttribute('role', 'tab');
    const arrow = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      cancelable: true,
    });
    Object.defineProperty(arrow, 'target', { value: tab });
    handler.onDetailKeydown.call(context, arrow);
    expect(next).not.toHaveBeenCalled();
    const prevented = new KeyboardEvent('keydown', {
      key: 'Escape',
      cancelable: true,
    });
    prevented.preventDefault();
    handler.onDetailKeydown.call(context, prevented);
    expect(close).not.toHaveBeenCalled();
    handler.onDetailKeydown.call(
      { ...context, surfaceActive: () => false },
      new KeyboardEvent('keydown', { key: 'Escape' }),
    );
    expect(close).not.toHaveBeenCalled();
  });
});

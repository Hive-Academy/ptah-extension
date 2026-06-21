import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
} from '@angular/core';

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'gridstack',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ng-content />',
})
export class GridstackComponent {
  readonly options = input<unknown>();
  readonly changeCB = output<unknown>();
  grid: unknown = null;
}

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'gridstack-item',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ng-content />',
})
export class GridstackItemComponent {
  readonly options = input<unknown>();
}

export const nodesCB = undefined;
export class GridStack {}

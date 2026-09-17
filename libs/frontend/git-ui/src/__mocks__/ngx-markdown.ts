import {
  ChangeDetectionStrategy,
  Component,
  Input,
  NgModule,
} from '@angular/core';

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'markdown',
  standalone: true,
  template: `<div data-testid="markdown-rendered">{{ data }}</div>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class MarkdownStubComponent {
  @Input() data = '';
}

@NgModule({
  imports: [MarkdownStubComponent],
  exports: [MarkdownStubComponent],
})
export class MarkdownModule {}

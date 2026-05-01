import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output,
  signal,
  OnInit,
} from '@angular/core';
import {
  AdminApiService,
  MarketingTemplate,
} from '../../../../services/admin-api.service';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'ptah-template-picker',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './template-picker.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TemplatePicker implements OnInit {
  private readonly adminApi = inject(AdminApiService);

  public readonly value = input<string | null>(null);
  public readonly valueChange = output<string | null>();

  protected readonly templates = signal<MarketingTemplate[]>([]);
  protected readonly isLoading = signal(false);
  protected readonly error = signal<string | null>(null);

  public ngOnInit(): void {
    this.fetch();
  }

  protected fetch(): void {
    this.isLoading.set(true);
    this.error.set(null);
    this.adminApi
      .list<MarketingTemplate>('marketing-campaign-templates', {
        pageSize: 100,
      })
      .subscribe({
        next: (res) => {
          this.templates.set(res.data);
          this.isLoading.set(false);
        },
        error: (err) => {
          this.error.set(err?.error?.message || 'Failed to load templates');
          this.isLoading.set(false);
        },
      });
  }

  protected onSelect(event: Event): void {
    const target = event.target as HTMLSelectElement;
    this.valueChange.emit(target.value || null);
  }

  protected select(id: string | null): void {
    this.valueChange.emit(id || null);
  }
}

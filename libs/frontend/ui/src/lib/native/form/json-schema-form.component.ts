import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  model,
  output,
} from '@angular/core';

export type JsonSchemaPropertyType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean';

export interface JsonSchemaProperty {
  readonly type?: JsonSchemaPropertyType;
  readonly title?: string;
  readonly description?: string;
  readonly format?: string;
  readonly enum?: ReadonlyArray<string | number>;
  readonly default?: unknown;
  readonly secret?: boolean;
  readonly writeOnly?: boolean;
}

export interface JsonSchemaObject {
  readonly type: 'object';
  readonly properties?: Readonly<Record<string, JsonSchemaProperty>>;
  readonly required?: readonly string[];
}

type FieldControl = 'text' | 'password' | 'number' | 'checkbox' | 'select';

interface RenderField {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly control: FieldControl;
  readonly required: boolean;
  readonly options: ReadonlyArray<string | number>;
}

@Component({
  selector: 'ptah-json-schema-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!isEmpty()) {
      <form class="flex flex-col gap-4">
        @for (field of fields(); track field.key) {
          <div class="form-control w-full">
            <label class="label" [attr.for]="'jsf-' + field.key">
              <span class="label-text">
                {{ field.label }}
                @if (field.required) {
                  <span class="text-error" aria-hidden="true">*</span>
                }
              </span>
            </label>

            @switch (field.control) {
              @case ('checkbox') {
                <input
                  type="checkbox"
                  class="toggle toggle-primary"
                  [id]="'jsf-' + field.key"
                  [attr.aria-required]="field.required"
                  [checked]="boolValue(field.key)"
                  (change)="onCheckbox(field.key, $event)"
                />
              }
              @case ('select') {
                <select
                  class="select select-bordered w-full"
                  [id]="'jsf-' + field.key"
                  [attr.aria-required]="field.required"
                  [value]="stringValue(field.key)"
                  (change)="onSelect(field, $event)"
                >
                  @if (!field.required) {
                    <option value=""></option>
                  }
                  @for (opt of field.options; track opt) {
                    <option [value]="opt">{{ opt }}</option>
                  }
                </select>
              }
              @case ('number') {
                <input
                  type="number"
                  class="input input-bordered w-full"
                  [id]="'jsf-' + field.key"
                  [attr.aria-required]="field.required"
                  [value]="stringValue(field.key)"
                  (input)="onNumber(field.key, $event)"
                />
              }
              @case ('password') {
                <input
                  type="password"
                  class="input input-bordered w-full"
                  autocomplete="off"
                  [id]="'jsf-' + field.key"
                  [attr.aria-required]="field.required"
                  [value]="stringValue(field.key)"
                  (input)="onText(field.key, $event)"
                />
              }
              @default {
                <input
                  type="text"
                  class="input input-bordered w-full"
                  [id]="'jsf-' + field.key"
                  [attr.aria-required]="field.required"
                  [value]="stringValue(field.key)"
                  (input)="onText(field.key, $event)"
                />
              }
            }

            @if (field.description) {
              <span class="label-text-alt mt-1 opacity-70">{{
                field.description
              }}</span>
            }
          </div>
        }
      </form>
    }
  `,
})
export class JsonSchemaFormComponent {
  readonly schema = input<JsonSchemaObject>();
  readonly value = model<Record<string, unknown>>({});

  readonly fields = computed<readonly RenderField[]>(() => {
    const schema = this.schema();
    const properties = schema?.properties;
    if (!properties) {
      return [];
    }
    const required = new Set(schema?.required ?? []);
    return Object.keys(properties).map((key) => {
      const prop = properties[key];
      return {
        key,
        label: prop.title && prop.title.length > 0 ? prop.title : key,
        description: prop.description ?? '',
        control: this.resolveControl(prop),
        required: required.has(key),
        options: prop.enum ?? [],
      } satisfies RenderField;
    });
  });

  readonly isEmpty = computed<boolean>(() => this.fields().length === 0);

  readonly defaults = computed<Record<string, unknown>>(() => {
    const schema = this.schema();
    const properties = schema?.properties;
    if (!properties) {
      return {};
    }
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(properties)) {
      const def = properties[key].default;
      if (def !== undefined) {
        result[key] = def;
      }
    }
    return result;
  });

  readonly effectiveValue = computed<Record<string, unknown>>(() => ({
    ...this.defaults(),
    ...this.value(),
  }));

  readonly valid = computed<boolean>(() => {
    const schema = this.schema();
    const required = schema?.required ?? [];
    if (required.length === 0) {
      return true;
    }
    const current = this.effectiveValue();
    return required.every((key) => {
      const raw = current[key];
      if (raw === undefined || raw === null) {
        return false;
      }
      if (typeof raw === 'string') {
        return raw.trim().length > 0;
      }
      return true;
    });
  });

  readonly validChange = output<boolean>();

  stringValue(key: string): string {
    const raw = this.effectiveValue()[key];
    if (raw === undefined || raw === null) {
      return '';
    }
    return String(raw);
  }

  boolValue(key: string): boolean {
    return this.effectiveValue()[key] === true;
  }

  onText(key: string, event: Event): void {
    this.patch(key, (event.target as HTMLInputElement).value);
  }

  onNumber(key: string, event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    if (raw === '') {
      this.patch(key, undefined);
      return;
    }
    const parsed = Number(raw);
    this.patch(key, Number.isNaN(parsed) ? undefined : parsed);
  }

  onCheckbox(key: string, event: Event): void {
    this.patch(key, (event.target as HTMLInputElement).checked);
  }

  onSelect(field: RenderField, event: Event): void {
    const raw = (event.target as HTMLSelectElement).value;
    if (raw === '') {
      this.patch(field.key, undefined);
      return;
    }
    const matched = field.options.find((opt) => String(opt) === raw);
    this.patch(field.key, matched ?? raw);
  }

  private resolveControl(prop: JsonSchemaProperty): FieldControl {
    if (prop.enum && prop.enum.length > 0) {
      return 'select';
    }
    if (prop.type === 'boolean') {
      return 'checkbox';
    }
    if (prop.type === 'number' || prop.type === 'integer') {
      return 'number';
    }
    if (
      prop.secret === true ||
      prop.writeOnly === true ||
      prop.format === 'password'
    ) {
      return 'password';
    }
    return 'text';
  }

  private patch(key: string, next: unknown): void {
    const current = { ...this.value() };
    if (next === undefined) {
      delete current[key];
    } else {
      current[key] = next;
    }
    this.value.set(current);
    this.validChange.emit(this.valid());
  }
}

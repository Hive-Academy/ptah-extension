import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  JsonSchemaFormComponent,
  JsonSchemaObject,
} from './json-schema-form.component';

describe('JsonSchemaFormComponent', () => {
  let fixture: ComponentFixture<JsonSchemaFormComponent>;
  let component: JsonSchemaFormComponent;
  let hostElement: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [JsonSchemaFormComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(JsonSchemaFormComponent);
    component = fixture.componentInstance;
    hostElement = fixture.nativeElement as HTMLElement;
  });

  const init = (schema?: JsonSchemaObject, value?: Record<string, unknown>) => {
    if (schema !== undefined) {
      fixture.componentRef.setInput('schema', schema);
    }
    if (value !== undefined) {
      fixture.componentRef.setInput('value', value);
    }
    fixture.detectChanges();
  };

  const q = <T extends HTMLElement>(selector: string): T | null =>
    hostElement.querySelector<T>(selector);

  const must = <T extends HTMLElement>(selector: string): T => {
    const el = hostElement.querySelector<T>(selector);
    if (el === null) {
      throw new Error(`Expected element for selector "${selector}"`);
    }
    return el;
  };

  describe('Initialization', () => {
    it('should create', () => {
      init();
      expect(component).toBeTruthy();
    });
  });

  describe('Empty schema → skipped / valid', () => {
    it('should be empty and valid with no schema', () => {
      init();
      expect(component.isEmpty()).toBe(true);
      expect(component.valid()).toBe(true);
      expect(q('form')).toBeNull();
    });

    it('should be empty with object schema that has no properties', () => {
      init({ type: 'object' });
      expect(component.isEmpty()).toBe(true);
      expect(component.valid()).toBe(true);
    });

    it('should render fields but be valid when there are no required props', () => {
      init({
        type: 'object',
        properties: { host: { type: 'string' } },
      });
      expect(component.isEmpty()).toBe(false);
      expect(component.valid()).toBe(true);
    });
  });

  describe('Field type rendering', () => {
    it('should render a text input for type string', () => {
      init({ type: 'object', properties: { host: { type: 'string' } } });
      const input = q<HTMLInputElement>('#jsf-host');
      expect(input).not.toBeNull();
      expect(input?.type).toBe('text');
    });

    it('should render a password input for format:password', () => {
      init({
        type: 'object',
        properties: { token: { type: 'string', format: 'password' } },
      });
      expect(q<HTMLInputElement>('#jsf-token')?.type).toBe('password');
    });

    it('should render a password input for secret marker', () => {
      init({
        type: 'object',
        properties: { apiKey: { type: 'string', secret: true } },
      });
      expect(q<HTMLInputElement>('#jsf-apiKey')?.type).toBe('password');
    });

    it('should render a password input for writeOnly marker', () => {
      init({
        type: 'object',
        properties: { pass: { type: 'string', writeOnly: true } },
      });
      expect(q<HTMLInputElement>('#jsf-pass')?.type).toBe('password');
    });

    it('should render a number input for type number', () => {
      init({ type: 'object', properties: { port: { type: 'number' } } });
      expect(q<HTMLInputElement>('#jsf-port')?.type).toBe('number');
    });

    it('should render a number input for type integer', () => {
      init({ type: 'object', properties: { count: { type: 'integer' } } });
      expect(q<HTMLInputElement>('#jsf-count')?.type).toBe('number');
    });

    it('should render a checkbox for type boolean', () => {
      init({ type: 'object', properties: { enabled: { type: 'boolean' } } });
      expect(q<HTMLInputElement>('#jsf-enabled')?.type).toBe('checkbox');
    });

    it('should render a select when enum is present', () => {
      init({
        type: 'object',
        properties: { region: { type: 'string', enum: ['us', 'eu'] } },
      });
      const select = q<HTMLSelectElement>('#jsf-region');
      expect(select?.tagName.toLowerCase()).toBe('select');
      const optionValues = Array.from(select?.options ?? []).map(
        (o) => o.value,
      );
      expect(optionValues).toContain('us');
      expect(optionValues).toContain('eu');
    });
  });

  describe('Labels / descriptions (no innerHTML)', () => {
    it('should render label and description as plain text', () => {
      init({
        type: 'object',
        properties: {
          host: {
            type: 'string',
            title: 'Server Host',
            description: 'The <b>hostname</b> to connect to',
          },
        },
      });
      const label = q('label[for="jsf-host"]');
      expect(label?.textContent).toContain('Server Host');
      const text = hostElement.textContent ?? '';
      expect(text).toContain('The <b>hostname</b> to connect to');
      expect(hostElement.querySelector('b')).toBeNull();
    });

    it('should not use innerHTML bindings in the template', () => {
      const source = JsonSchemaFormComponent.toString();
      expect(source).not.toContain('innerHTML');
    });
  });

  describe('Defaults', () => {
    it('should pre-populate input from schema default', () => {
      init({
        type: 'object',
        properties: { host: { type: 'string', default: 'localhost' } },
      });
      expect(q<HTMLInputElement>('#jsf-host')?.value).toBe('localhost');
    });
  });

  describe('Required validation', () => {
    it('should be invalid when a required field is missing', () => {
      init({
        type: 'object',
        properties: { apiKey: { type: 'string' } },
        required: ['apiKey'],
      });
      expect(component.valid()).toBe(false);
    });

    it('should be valid when required field is provided', () => {
      init(
        {
          type: 'object',
          properties: { apiKey: { type: 'string' } },
          required: ['apiKey'],
        },
        { apiKey: 'sk-123' },
      );
      expect(component.valid()).toBe(true);
    });

    it('should treat whitespace-only string as missing for required', () => {
      init(
        {
          type: 'object',
          properties: { apiKey: { type: 'string' } },
          required: ['apiKey'],
        },
        { apiKey: '   ' },
      );
      expect(component.valid()).toBe(false);
    });

    it('should satisfy required via schema default', () => {
      init({
        type: 'object',
        properties: { region: { type: 'string', default: 'us' } },
        required: ['region'],
      });
      expect(component.valid()).toBe(true);
    });
  });

  describe('Value emission via model', () => {
    it('should update value on text input', () => {
      init({ type: 'object', properties: { host: { type: 'string' } } });
      const input = must<HTMLInputElement>('#jsf-host');
      input.value = 'example.com';
      input.dispatchEvent(new Event('input'));
      expect(component.value()['host']).toBe('example.com');
    });

    it('should coerce number inputs to numbers', () => {
      init({ type: 'object', properties: { port: { type: 'number' } } });
      const input = must<HTMLInputElement>('#jsf-port');
      input.value = '8080';
      input.dispatchEvent(new Event('input'));
      expect(component.value()['port']).toBe(8080);
    });

    it('should update boolean value on checkbox toggle', () => {
      init({ type: 'object', properties: { enabled: { type: 'boolean' } } });
      const input = must<HTMLInputElement>('#jsf-enabled');
      input.checked = true;
      input.dispatchEvent(new Event('change'));
      expect(component.value()['enabled']).toBe(true);
    });

    it('should update value on select change', () => {
      init({
        type: 'object',
        properties: { region: { type: 'string', enum: ['us', 'eu'] } },
      });
      const select = must<HTMLSelectElement>('#jsf-region');
      select.value = 'eu';
      select.dispatchEvent(new Event('change'));
      expect(component.value()['region']).toBe('eu');
    });

    it('should emit validChange when a required field becomes filled', () => {
      init({
        type: 'object',
        properties: { apiKey: { type: 'string' } },
        required: ['apiKey'],
      });
      const emitted: boolean[] = [];
      component.validChange.subscribe((v) => emitted.push(v));

      const input = must<HTMLInputElement>('#jsf-apiKey');
      input.value = 'sk-123';
      input.dispatchEvent(new Event('input'));

      expect(emitted).toContain(true);
      expect(component.valid()).toBe(true);
    });

    it('should store empty string when a text field is cleared', () => {
      init(
        { type: 'object', properties: { host: { type: 'string' } } },
        { host: 'x' },
      );
      const input = must<HTMLInputElement>('#jsf-host');
      input.value = '';
      input.dispatchEvent(new Event('input'));
      expect(component.value()['host']).toBe('');
    });

    it('should remove key from value when a number field is cleared', () => {
      init(
        { type: 'object', properties: { port: { type: 'number' } } },
        { port: 8080 },
      );
      const input = must<HTMLInputElement>('#jsf-port');
      input.value = '';
      input.dispatchEvent(new Event('input'));
      expect('port' in component.value()).toBe(false);
    });
  });
});

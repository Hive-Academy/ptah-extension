import { TestBed } from '@angular/core/testing';
import { ErrorAlertComponent } from './error-alert.component';

describe('ErrorAlertComponent', () => {
  it('renders the provided error message', async () => {
    await TestBed.configureTestingModule({
      imports: [ErrorAlertComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(ErrorAlertComponent);
    fixture.componentRef.setInput('errorMessage', 'Boom!');
    fixture.detectChanges();

    expect(fixture.componentInstance).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Boom!');
    expect(fixture.nativeElement.querySelector('.alert-error')).not.toBeNull();
  });
});

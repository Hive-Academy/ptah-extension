import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Providers } from './providers';

describe('Providers', () => {
  let component: Providers;
  let fixture: ComponentFixture<Providers>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Providers],
    }).compileComponents();

    fixture = TestBed.createComponent(Providers);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

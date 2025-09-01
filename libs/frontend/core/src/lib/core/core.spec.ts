import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Core } from './core';

describe('Core', () => {
  let component: Core;
  let fixture: ComponentFixture<Core>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Core],
    }).compileComponents();

    fixture = TestBed.createComponent(Core);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

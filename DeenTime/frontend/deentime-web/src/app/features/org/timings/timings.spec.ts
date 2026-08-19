import { provideZonelessChangeDetection } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { throwError } from 'rxjs';
import { AuthService } from '../../../services/auth';
import { TimingsService } from '../../../services/timings';
import { TimingsComponent } from './timings';

describe('TimingsComponent setup state', () => {
  it('turns missing criteria into a guided setup action', () => {
    const service = {
      getForDate: jasmine.createSpy('getForDate').and.returnValue(
        throwError(() => new HttpErrorResponse({ status: 404, error: { title: 'Not Found' } }))
      )
    };

    TestBed.configureTestingModule({
      imports: [TimingsComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { params: { orgId: 'org-1' } } } },
        { provide: AuthService, useValue: { getOrgId: () => 'org-1' } },
        { provide: TimingsService, useValue: service }
      ]
    });

    const fixture = TestBed.createComponent(TimingsComponent);
    fixture.componentInstance.ngOnInit();
    fixture.detectChanges();

    expect(fixture.componentInstance.needsCriteria()).toBeTrue();
    expect(fixture.componentInstance.error()).toBe('');
    expect(fixture.nativeElement.textContent).toContain('Tell IqamaTime where your mosque is.');
    expect(fixture.nativeElement.querySelector('a')?.getAttribute('href')).toBe('/org/org-1/profile');
  });
});

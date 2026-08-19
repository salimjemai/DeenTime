import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { PublicDisplay } from '../../models';
import { PublicDisplayService } from '../../services/public-display';
import { WidgetComponent } from './widget';

describe('WidgetComponent typography', () => {
  const display = {
    organization: { name: 'Test Mosque', slug: 'test' },
    date: '2026-08-18',
    timezoneId: 'UTC',
    timings: {
      date: '2026-08-18',
      fajr: '05:00:00',
      sunrise: '06:00:00',
      dhuhr: '13:00:00',
      asr: '17:00:00',
      maghrib: '20:00:00',
      sunset: '20:01:00',
      isha: '21:00:00'
    },
    iqama: [],
    design: {
      iqamaHeadings: [],
      tvFontScale: 75,
      widgetFontScale: 125,
      compactFontScale: 160,
      tvFontFamily: 'classic-serif',
      widgetFontFamily: 'modern-sans',
      compactFontFamily: 'system'
    }
  } as PublicDisplay;

  function create(variant: 'full' | 'compact', query: Record<string, string> = {}) {
    const service = { get: jasmine.createSpy('get').and.returnValue(of(display)) };
    TestBed.configureTestingModule({
      imports: [WidgetComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: ActivatedRoute, useValue: { snapshot: { params: { slug: 'test' }, data: { variant }, queryParamMap: convertToParamMap(query) } } },
        { provide: PublicDisplayService, useValue: service }
      ]
    });
    const fixture = TestBed.createComponent(WidgetComponent);
    fixture.componentInstance.ngOnInit();
    return { fixture, component: fixture.componentInstance, service };
  }

  it('uses compact scale and family independently from the full widget', () => {
    const full = create('full');
    expect(full.component.fontScale()).toBe(125);
    expect(full.component.fontFamily()).toBe('modern-sans');
    expect(full.service.get).toHaveBeenCalledWith('test', 'widget');

    TestBed.resetTestingModule();

    const compact = create('compact');
    expect(compact.component.fontScale()).toBe(160);
    expect(compact.component.fontFamily()).toBe('system');
    expect(compact.service.get).toHaveBeenCalledWith('test', 'compact');
  });

  it('forwards iframe display parameters to the public API', () => {
    const compact = create('compact', { theme: 'classic', fontScale: '120', locale: 'ur' });
    expect(compact.service.get).toHaveBeenCalledWith('test', 'compact', {
      theme: 'classic',
      fontScale: '120',
      locale: 'ur'
    });
  });

  it('keeps fixed and offset Iqama values visible while Adhan criteria are incomplete', () => {
    const full = create('full');
    full.component.display.set({
      ...display,
      timings: undefined,
      iqama: [
        { salah: 'Fajr', time: '06:15' },
        { salah: 'Maghrib', offsetMinutes: 5 }
      ]
    });
    full.component.timings.set(null);

    expect(full.component.timeFor('fajr')).toBe('—');
    expect(full.component.iqamaFor('Fajr')).toBe('6:15');
    expect(full.component.iqamaFor('Maghrib')).toBe('+5 min');
  });
});

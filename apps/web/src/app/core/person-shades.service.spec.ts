import { TestBed } from '@angular/core/testing';
import { personHue } from '@retro/shared';
import { PERSON_SHADES_STORAGE_KEY, PersonShades } from './person-shades.service';

describe('PersonShades', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('is on by default and gives a person their hue', () => {
    const svc = TestBed.inject(PersonShades);
    expect(svc.enabled()).toBe(true);
    expect(svc.hueFor({ id: 'u-alex' })).toBe(personHue('u-alex'));
    expect(svc.hueFor(null)).toBeNull();
  });

  it('turns off, remembers that, and then shades nobody', () => {
    TestBed.inject(PersonShades).toggle();
    expect(localStorage.getItem(PERSON_SHADES_STORAGE_KEY)).toBe('off');
    TestBed.resetTestingModule();
    const again = TestBed.inject(PersonShades);
    expect(again.enabled()).toBe(false);
    expect(again.hueFor({ id: 'u-alex' })).toBeNull();
  });
});

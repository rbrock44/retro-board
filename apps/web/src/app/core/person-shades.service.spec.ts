import { TestBed } from '@angular/core/testing';
import { ALL_FEATURES_ON, personHue, type AuthConfigDto } from '@retro/shared';
import { AuthService } from './auth.service';
import { PersonShades } from './person-shades.service';

function withConfig(personShades: boolean) {
  TestBed.resetTestingModule();
  const auth = TestBed.inject(AuthService);
  auth.config.set({ site: { name: 'Retro Board', theme: null, features: { ...ALL_FEATURES_ON, personShades } } } as AuthConfigDto);
  return TestBed.inject(PersonShades);
}

describe('PersonShades', () => {
  it('gives a person their hue while the feature is on', () => {
    const svc = withConfig(true);
    expect(svc.hueFor({ id: 'u-alex' })).toBe(personHue('u-alex'));
    expect(svc.hueFor(null)).toBeNull();
  });

  it('shades nobody when an admin switches it off', () => {
    expect(withConfig(false).hueFor({ id: 'u-alex' })).toBeNull();
  });
});

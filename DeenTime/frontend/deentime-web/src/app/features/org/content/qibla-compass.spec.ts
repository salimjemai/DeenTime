import {
  headingFromOrientation,
  normalizeDegrees,
  signedTurnToBearing,
  smoothCompassHeading
} from './qibla-compass';

describe('Qibla compass helpers', () => {
  it('normalizes bearings into a single clockwise revolution', () => {
    expect(normalizeDegrees(370)).toBe(10);
    expect(normalizeDegrees(-10)).toBe(350);
  });

  it('uses the iOS compass heading when it is available', () => {
    expect(headingFromOrientation({
      alpha: 120,
      absolute: false,
      webkitCompassHeading: 43.4
    })).toBeCloseTo(43.4, 6);
  });

  it('converts an absolute W3C alpha reading into a compass heading', () => {
    expect(headingFromOrientation({ alpha: 340, absolute: true })).toBe(20);
    expect(headingFromOrientation({
      alpha: 270,
      absolute: false,
      type: 'deviceorientationabsolute'
    })).toBe(90);
    expect(headingFromOrientation({ alpha: 20, absolute: false })).toBeNull();
  });

  it('reports the shortest left or right turn toward Qibla', () => {
    expect(signedTurnToBearing(10, 350)).toBe(20);
    expect(signedTurnToBearing(350, 10)).toBe(-20);
  });

  it('smooths across north without sending the needle around the dial', () => {
    expect(smoothCompassHeading(358, 2, 0.5)).toBe(0);
    expect(smoothCompassHeading(2, 358, 0.5)).toBe(0);
  });
});

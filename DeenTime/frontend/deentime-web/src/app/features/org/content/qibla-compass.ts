export interface CompassOrientationReading {
  alpha: number | null;
  absolute: boolean;
  type?: string;
  webkitCompassHeading?: number | null;
}

export function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

export function headingFromOrientation(reading: CompassOrientationReading): number | null {
  if (Number.isFinite(reading.webkitCompassHeading)) {
    return normalizeDegrees(reading.webkitCompassHeading!);
  }

  if (!Number.isFinite(reading.alpha)) return null;
  if (!reading.absolute && reading.type !== 'deviceorientationabsolute') return null;

  // DeviceOrientation alpha runs opposite to a compass bearing when the phone is flat.
  return normalizeDegrees(360 - reading.alpha!);
}

export function signedTurnToBearing(targetBearing: number, deviceHeading: number): number {
  const turn = normalizeDegrees(targetBearing - deviceHeading + 180) - 180;
  return turn === -180 ? 180 : turn;
}

export function smoothCompassHeading(
  previousHeading: number | null,
  nextHeading: number,
  smoothing = 0.24
): number {
  if (previousHeading === null) return normalizeDegrees(nextHeading);
  const weight = Math.min(1, Math.max(0, smoothing));
  const shortestDelta = signedTurnToBearing(nextHeading, previousHeading);
  return normalizeDegrees(previousHeading + shortestDelta * weight);
}

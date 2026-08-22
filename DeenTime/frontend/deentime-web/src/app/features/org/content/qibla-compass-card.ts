import { Component, DestroyRef, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { QiblaDirectionResponse } from '../../../models';
import {
  headingFromOrientation,
  normalizeDegrees,
  signedTurnToBearing,
  smoothCompassHeading
} from './qibla-compass';

type LiveCompassState =
  | 'idle'
  | 'permission-required'
  | 'requesting'
  | 'listening'
  | 'live'
  | 'denied'
  | 'unsupported'
  | 'insecure';

type CompassOrientationEvent = DeviceOrientationEvent & {
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
};

type DeviceOrientationConstructor = typeof DeviceOrientationEvent & {
  requestPermission?: (absolute?: boolean) => Promise<PermissionState>;
};

@Component({
  selector: 'app-qibla-compass-card',
  standalone: true,
  imports: [MatIconModule],
  templateUrl: './qibla-compass-card.html',
  styleUrl: './qibla-compass-card.scss'
})
export class QiblaCompassCardComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private orientationListenersActive = false;
  private absoluteOrientationSeen = false;
  private smoothedDeviceHeading: number | null = null;
  private sensorWaitTimer: number | undefined;

  readonly qibla = input<QiblaDirectionResponse | null>(null);
  readonly loading = input(true);
  readonly error = input('');
  readonly location = input('Your masjid');
  readonly compassUrl = input('');
  readonly retryRequested = output<void>();
  readonly copyApiRequested = output<void>();

  readonly liveCompassState = signal<LiveCompassState>('idle');
  readonly deviceHeading = signal<number | null>(null);
  readonly compassAccuracy = signal<number | null>(null);
  readonly qiblaTurn = computed(() => {
    const target = this.qibla()?.data.direction;
    const heading = this.deviceHeading();
    return target === undefined || heading === null ? null : signedTurnToBearing(target, heading);
  });
  readonly qiblaAligned = computed(() => {
    const turn = this.qiblaTurn();
    return turn !== null && Math.abs(turn) <= 4;
  });

  ngOnInit() {
    this.prepareLiveCompass();
    this.destroyRef.onDestroy(() => this.stopLiveCompassListeners());
  }

  qiblaRotation() {
    const direction = this.qibla()?.data.direction ?? 0;
    const heading = this.deviceHeading();
    return `rotate(${heading === null ? direction : normalizeDegrees(direction - heading)}deg)`;
  }

  compassRoseRotation() {
    const heading = this.deviceHeading();
    return `rotate(${heading === null ? 0 : -heading}deg)`;
  }

  qiblaBearingLabel() {
    const direction = this.qibla()?.data.direction;
    return direction === undefined ? '—' : `${direction.toFixed(1)}° ${this.cardinalDirection(direction)}`;
  }

  deviceHeadingLabel() {
    const heading = this.deviceHeading();
    return heading === null ? 'Waiting for heading' : `${heading.toFixed(1)}° ${this.cardinalDirection(heading)}`;
  }

  compassAccuracyLabel() {
    const accuracy = this.compassAccuracy();
    return accuracy === null ? '' : ` · accuracy ±${accuracy.toFixed(0)}°`;
  }

  liveCompassGuidance() {
    const turn = this.qiblaTurn();
    if (turn === null) {
      switch (this.liveCompassState()) {
        case 'permission-required': return 'Make this compass live';
        case 'requesting': return 'Connecting to the sensor';
        case 'listening': return 'Waiting for phone heading';
        case 'denied': return 'Compass permission needed';
        case 'unsupported': return 'Static bearing on this device';
        case 'insecure': return 'Secure connection required';
        default: return 'Preparing live compass';
      }
    }
    if (Math.abs(turn) <= 4) return 'Aligned with Qibla';
    return `Turn ${Math.max(1, Math.round(Math.abs(turn)))}° ${turn > 0 ? 'right' : 'left'}`;
  }

  liveCompassStatusMessage() {
    switch (this.liveCompassState()) {
      case 'permission-required': return 'Allow motion access to make the compass follow your phone.';
      case 'requesting': return 'Requesting motion access…';
      case 'listening': return 'Move your phone gently while holding it flat.';
      case 'live': return 'Live direction from this device';
      case 'denied': return 'Motion access was denied. You can try again in your browser settings.';
      case 'unsupported': return 'Live direction needs a phone or tablet with a compass sensor.';
      case 'insecure': return 'Live direction requires HTTPS when this app is deployed.';
      default: return 'Preparing the live compass…';
    }
  }

  async enableLiveCompass() {
    if (typeof window === 'undefined' || typeof globalThis.DeviceOrientationEvent === 'undefined') {
      this.liveCompassState.set('unsupported');
      return;
    }
    if (!window.isSecureContext) {
      this.liveCompassState.set('insecure');
      return;
    }

    const orientation = globalThis.DeviceOrientationEvent as DeviceOrientationConstructor;
    this.liveCompassState.set('requesting');
    try {
      if (typeof orientation.requestPermission === 'function') {
        const permission = await orientation.requestPermission(true);
        if (permission !== 'granted') {
          this.liveCompassState.set('denied');
          return;
        }
      }
      this.startLiveCompassListeners();
    } catch {
      this.liveCompassState.set('denied');
    }
  }

  private readonly handleDeviceOrientation = (event: Event) => {
    const reading = event as CompassOrientationEvent;
    const appleHeading = Number.isFinite(reading.webkitCompassHeading)
      ? reading.webkitCompassHeading
      : undefined;
    const heading = headingFromOrientation({
      alpha: reading.alpha,
      absolute: reading.absolute,
      type: reading.type,
      webkitCompassHeading: appleHeading
    });
    if (heading === null) return;

    if (reading.type === 'deviceorientationabsolute') this.absoluteOrientationSeen = true;
    if (reading.type === 'deviceorientation' && this.absoluteOrientationSeen && appleHeading === undefined) return;

    this.clearSensorWaitTimer();
    this.smoothedDeviceHeading = smoothCompassHeading(this.smoothedDeviceHeading, heading);
    this.deviceHeading.set(this.smoothedDeviceHeading);
    this.compassAccuracy.set(
      Number.isFinite(reading.webkitCompassAccuracy) && reading.webkitCompassAccuracy! >= 0
        ? reading.webkitCompassAccuracy!
        : null
    );
    this.liveCompassState.set('live');
  };

  private prepareLiveCompass() {
    if (typeof window === 'undefined' || typeof globalThis.DeviceOrientationEvent === 'undefined') {
      this.liveCompassState.set('unsupported');
      return;
    }
    if (!window.isSecureContext) {
      this.liveCompassState.set('insecure');
      return;
    }

    const orientation = globalThis.DeviceOrientationEvent as DeviceOrientationConstructor;
    if (typeof orientation.requestPermission === 'function') {
      this.liveCompassState.set('permission-required');
      return;
    }
    this.startLiveCompassListeners();
  }

  private startLiveCompassListeners() {
    if (this.orientationListenersActive || typeof window === 'undefined') return;
    window.addEventListener('deviceorientationabsolute', this.handleDeviceOrientation);
    window.addEventListener('deviceorientation', this.handleDeviceOrientation);
    this.orientationListenersActive = true;
    this.liveCompassState.set('listening');
    this.clearSensorWaitTimer();
    this.sensorWaitTimer = window.setTimeout(() => {
      if (this.deviceHeading() === null && this.liveCompassState() === 'listening') {
        this.liveCompassState.set('unsupported');
      }
    }, 2800);
  }

  private stopLiveCompassListeners() {
    this.clearSensorWaitTimer();
    if (!this.orientationListenersActive || typeof window === 'undefined') return;
    window.removeEventListener('deviceorientationabsolute', this.handleDeviceOrientation);
    window.removeEventListener('deviceorientation', this.handleDeviceOrientation);
    this.orientationListenersActive = false;
  }

  private clearSensorWaitTimer() {
    if (this.sensorWaitTimer === undefined || typeof window === 'undefined') return;
    window.clearTimeout(this.sensorWaitTimer);
    this.sensorWaitTimer = undefined;
  }

  private cardinalDirection(degrees: number) {
    const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    return directions[Math.round(normalizeDegrees(degrees) / 22.5) % directions.length];
  }
}

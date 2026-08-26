import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  inject,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  PLATFORM_ID,
  SimpleChanges,
  ViewChild
} from '@angular/core';

interface TurnstileApi {
  render(element: HTMLElement, options: {
    sitekey: string;
    action: string;
    theme: 'auto';
    callback: (token: string) => void;
    'expired-callback': () => void;
    'error-callback': () => void;
  }): string;
  remove(widgetId: string): void;
}

declare global {
  interface Window { turnstile?: TurnstileApi; }
}

@Component({
  selector: 'app-turnstile',
  standalone: true,
  template: '<div #container class="turnstile-container" aria-label="Security verification"></div>',
  styles: [':host { display: block; min-height: 65px; } .turnstile-container { display: flex; justify-content: center; }']
})
export class TurnstileComponent implements AfterViewInit, OnChanges, OnDestroy {
  private static scriptPromise?: Promise<void>;
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);
  private widgetId?: string;
  private viewReady = false;

  @Input({ required: true }) siteKey = '';
  @Input() action = 'login';
  @Output() tokenChange = new EventEmitter<string>();
  @ViewChild('container', { static: true }) container!: ElementRef<HTMLElement>;

  ngAfterViewInit(): void {
    this.viewReady = true;
    void this.render();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (this.viewReady && (changes['siteKey'] || changes['action'])) void this.render();
  }

  ngOnDestroy(): void {
    this.removeWidget();
  }

  private async render(): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || !this.siteKey) return;
    await this.loadScript();
    this.removeWidget();
    this.tokenChange.emit('');
    const api = window.turnstile;
    if (!api) return;
    this.widgetId = api.render(this.container.nativeElement, {
      sitekey: this.siteKey,
      action: this.action,
      theme: 'auto',
      callback: token => this.tokenChange.emit(token),
      'expired-callback': () => this.tokenChange.emit(''),
      'error-callback': () => this.tokenChange.emit('')
    });
  }

  private removeWidget(): void {
    if (this.widgetId && typeof window !== 'undefined' && window.turnstile) {
      window.turnstile.remove(this.widgetId);
      this.widgetId = undefined;
    }
  }

  private loadScript(): Promise<void> {
    if (window.turnstile) return Promise.resolve();
    if (TurnstileComponent.scriptPromise) return TurnstileComponent.scriptPromise;

    TurnstileComponent.scriptPromise = new Promise<void>((resolve, reject) => {
      const existing = this.document.querySelector<HTMLScriptElement>('script[data-iqamatime-turnstile]');
      const script = existing ?? this.document.createElement('script');
      script.addEventListener('load', () => resolve(), { once: true });
      script.addEventListener('error', () => reject(new Error('Security verification could not load.')), { once: true });
      if (!existing) {
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        script.defer = true;
        script.dataset['iqamatimeTurnstile'] = 'true';
        this.document.head.appendChild(script);
      }
    });
    return TurnstileComponent.scriptPromise;
  }
}

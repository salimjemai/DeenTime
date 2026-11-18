import { Component, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterOutlet } from '@angular/router';
import { BRAND } from './brand';
import { environment } from '../environments/environment';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly title = signal(environment.backend === 'cloudflare' ? BRAND.name : 'IqamaTime');

  constructor() {
    if (environment.backend === 'cloudflare') inject(Title).setTitle(`${BRAND.name} · Masjid prayer times`);
  }
}

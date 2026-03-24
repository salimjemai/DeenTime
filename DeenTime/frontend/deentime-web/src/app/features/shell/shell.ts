import { Component, inject, computed, OnInit } from '@angular/core';
import { Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { AuthService } from '../../services/auth';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [
    RouterOutlet, RouterLink, RouterLinkActive,
    MatToolbarModule, MatSidenavModule, MatListModule,
    MatIconModule, MatButtonModule
  ],
  templateUrl: './shell.html',
  styleUrl: './shell.scss'
})
export class ShellComponent implements OnInit {
  private auth   = inject(AuthService);
  private router = inject(Router);

  orgId   = computed(() => this.auth.getOrgId() ?? '');
  email   = computed(() => this.auth.getEmail() ?? '');

  ngOnInit() {
    if (this.router.url === '/') {
      const orgId = this.auth.getOrgId();
      if (orgId) this.router.navigate(['/org', orgId, 'timings']);
    }
  }

  navItems = [
    { label: 'Prayer Times', icon: 'schedule',    path: 'timings'  },
    { label: 'Iqama',        icon: 'mosque',       path: 'iqama'    },
    { label: 'Design',       icon: 'palette',      path: 'design'   },
    { label: 'Hijri',        icon: 'calendar_month', path: 'hijri'  },
    { label: 'Publish',      icon: 'picture_as_pdf', path: 'publish'},
    { label: 'Profile',      icon: 'settings',     path: 'profile'  },
  ];

  logout() { this.auth.logout(); }
}

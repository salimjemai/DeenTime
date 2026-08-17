import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { HELP_TABS, HelpTipsService } from '../../../services/help-tips';

@Component({
  selector: 'app-help',
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatIconModule],
  templateUrl: './help.html',
  styleUrl: './help.scss'
})
export class HelpComponent implements OnInit {
  private route = inject(ActivatedRoute);
  readonly tips = inject(HelpTipsService);

  readonly orgId = this.route.snapshot.params['slug'] as string;
  readonly tabs = HELP_TABS;
  readonly outputs = [
    { icon: 'tv', label: 'TV display', detail: 'Live prayer and Iqama board' },
    { icon: 'web', label: 'Website widgets', detail: 'Full and compact embeds' },
    { icon: 'picture_as_pdf', label: 'Printable schedules', detail: 'Monthly, yearly, and Ramadan' },
    { icon: 'phone_iphone', label: 'Web and mobile apps', detail: 'Structured data for community apps' },
    { icon: 'api', label: 'Developer API', detail: 'Custom signage and integrations' }
  ];

  ngOnInit() {
    this.tips.markWelcomeSeen();
  }

  toggleTips() {
    this.tips.setTipsEnabled(!this.tips.tipsEnabled());
  }

  restartGuidance() {
    this.tips.reset();
  }
}

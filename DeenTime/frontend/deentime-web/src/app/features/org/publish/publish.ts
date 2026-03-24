import { Component, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { PublishService } from '../../../services/publish';
import { AuthService } from '../../../services/auth';
import { PublishArtifact, PdfSize, PdfOrientation } from '../../../models';

@Component({
  selector: 'app-publish',
  standalone: true,
  imports: [
    FormsModule, MatCardModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatSelectModule, MatInputModule,
    MatTableModule, MatProgressSpinnerModule, MatSnackBarModule
  ],
  templateUrl: './publish.html',
  styleUrl: './publish.scss'
})
export class PublishComponent implements OnInit {
  private svc   = inject(PublishService);
  private auth  = inject(AuthService);
  private snack = inject(MatSnackBar);

  orgId      = this.auth.getOrgId() ?? '';
  generating = signal(false);
  loading    = signal(false);
  artifacts  = signal<PublishArtifact[]>([]);

  genYear        = new Date().getFullYear();
  genMonth       = new Date().getMonth() + 1;
  genSize: PdfSize        = 'Letter';
  genOrientation: PdfOrientation = 'Portrait';

  sizes: PdfSize[]               = ['Letter','Tabloid'];
  orientations: PdfOrientation[] = ['Portrait','Landscape'];
  months = Array.from({length:12},(_,i)=>({ value: i+1, label: new Date(0,i).toLocaleString('default',{month:'long'}) }));
  columns = ['period','size','orientation','download'];

  ngOnInit() { this.loadArtifacts(); }

  loadArtifacts() {
    this.loading.set(true);
    this.svc.listArtifacts(this.orgId, this.genYear).subscribe({
      next: a => { this.artifacts.set(a); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }

  generate() {
    this.generating.set(true);
    this.svc.generatePdf({ orgId: this.orgId, year: this.genYear, month: this.genMonth, size: this.genSize, orientation: this.genOrientation }).subscribe({
      next: () => { this.generating.set(false); this.loadArtifacts(); this.snack.open('PDF generated!', '', { duration: 3000 }); },
      error: () => { this.generating.set(false); this.snack.open('Generation failed', 'Dismiss', { duration: 3000 }); }
    });
  }
}

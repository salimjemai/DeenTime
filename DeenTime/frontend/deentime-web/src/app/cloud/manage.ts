import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { BRAND } from '../brand';
import { CloudAuthService } from './cloud-auth.service';
import { IqamaRule, Masjid, MasjidApiService, MasjidMessage, SALAH, SalahName, WidgetSettings } from './masjid-api.service';
import { MasjidDetailsFieldsComponent, buildDetailsForm, detailsInput } from './masjid-details-fields';
import { errorMessage, fieldErrors } from './shared-auth.contract';

interface IqamaRow { key: SalahName; label: string; mode: 'none' | 'fixed' | 'offset'; time: string; minutes: number }
type MessageDraft = Omit<MasjidMessage, 'id'> & { id?: string };

const emptyMessage = (): MessageDraft => ({ title: '', body: '', startsOn: null, endsOn: null, pinned: false });

/** The masjid dashboard: details, iqama and Jumu'ah, messages, widgets and sharing. */
@Component({
  selector: 'app-cloud-manage',
  standalone: true,
  imports: [
    FormsModule, ReactiveFormsModule, RouterLink, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatInputModule,
    MatProgressSpinnerModule, MatSelectModule, MatSlideToggleModule, MatSnackBarModule, MatTabsModule, MasjidDetailsFieldsComponent
  ],
  templateUrl: './manage.html',
  styleUrl: './cloud-pages.scss'
})
export class CloudManageComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(MasjidApiService);
  private readonly auth = inject(CloudAuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);
  private readonly document = inject(DOCUMENT);

  readonly brand = BRAND;
  readonly welcome = this.route.snapshot.queryParamMap.has('welcome');
  readonly masjid = signal<Masjid | null>(null);
  readonly loadError = signal('');
  readonly saving = signal(false);
  details: FormGroup = buildDetailsForm(this.fb);
  iqama: IqamaRow[] = [];
  jumuah: string[] = [];
  widget: WidgetSettings = { theme: 'light', accent: '#0f766e', showIqama: true, showMessages: true, showJumuah: true };
  readonly messages = signal<MasjidMessage[]>([]);
  draft: MessageDraft = emptyMessage();

  readonly publicUrl = computed(() => {
    const m = this.masjid();
    return m ? new URL(`m/${m.slug}`, this.document.baseURI).toString() : '';
  });
  readonly widgetUrl = computed(() => (this.publicUrl() ? `${this.publicUrl()}?embed=1` : ''));
  readonly embedCode = computed(() =>
    this.widgetUrl() ? `<iframe src="${this.widgetUrl()}" title="${this.masjid()!.name} prayer times" style="width:100%;max-width:420px;height:560px;border:0" loading="lazy"></iframe>` : ''
  );

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id')!;
    this.api.get(id).subscribe({
      next: masjid => this.load(masjid),
      error: err => this.loadError.set(errorMessage(err, 'This masjid could not be loaded.'))
    });
    this.api.messages(id).subscribe({ next: list => this.messages.set(list), error: () => undefined });
  }

  saveDetails(): void {
    this.details.markAllAsTouched();
    if (this.details.invalid) {
      this.snack.open('Check the highlighted fields.', 'Dismiss', { duration: 4000 });
      return;
    }
    this.save(detailsInput(this.details), 'Details saved');
  }

  saveIqama(): void {
    const rules: Partial<Record<SalahName, IqamaRule>> = {};
    for (const row of this.iqama) {
      rules[row.key] = row.mode === 'fixed' ? { mode: 'fixed', time: row.time } : row.mode === 'offset' ? { mode: 'offset', minutes: Number(row.minutes) } : { mode: 'none' };
    }
    this.save({ iqama: rules, jumuah: this.jumuah.filter(Boolean) }, 'Iqama and Jumu\'ah saved');
  }

  addJumuah(): void {
    if (this.jumuah.length < 4) this.jumuah = [...this.jumuah, '13:30'];
  }

  removeJumuah(index: number): void {
    this.jumuah = this.jumuah.filter((_, i) => i !== index);
  }

  saveWidget(): void {
    this.save({ widget: this.widget }, 'Widget saved');
  }

  editMessage(message: MasjidMessage): void {
    this.draft = { ...message };
  }

  cancelMessage(): void {
    this.draft = emptyMessage();
  }

  saveMessage(): void {
    const masjid = this.masjid();
    if (!masjid || !this.draft.title.trim()) return;
    const draft = { ...this.draft, startsOn: this.draft.startsOn || null, endsOn: this.draft.endsOn || null };
    const request = draft.id ? this.api.updateMessage(masjid.id, draft as MasjidMessage) : this.api.addMessage(masjid.id, draft);
    request.subscribe({
      next: saved => {
        this.messages.update(list => [saved, ...list.filter(m => m.id !== saved.id)].sort((a, b) => Number(b.pinned) - Number(a.pinned)));
        this.draft = emptyMessage();
        this.snack.open('Message saved', undefined, { duration: 2500 });
      },
      error: err => this.snack.open(this.describe(err), 'Dismiss', { duration: 5000 })
    });
  }

  deleteMessage(message: MasjidMessage): void {
    const masjid = this.masjid();
    if (!masjid || !confirm(`Delete "${message.title}"?`)) return;
    this.api.deleteMessage(masjid.id, message.id).subscribe({
      next: () => this.messages.update(list => list.filter(m => m.id !== message.id)),
      error: err => this.snack.open(this.describe(err), 'Dismiss', { duration: 5000 })
    });
  }

  copy(text: string): void {
    navigator.clipboard?.writeText(text).then(() => this.snack.open('Copied', undefined, { duration: 2000 }));
  }

  signOut(): void {
    this.auth.signOut();
    this.router.navigate(['/login']);
  }

  private save(input: Parameters<MasjidApiService['update']>[1], done: string): void {
    const masjid = this.masjid();
    if (!masjid) return;
    this.saving.set(true);
    this.api.update(masjid.id, input).subscribe({
      next: updated => {
        this.saving.set(false);
        this.load(updated);
        this.snack.open(done, undefined, { duration: 2500 });
      },
      error: err => {
        this.saving.set(false);
        this.snack.open(this.describe(err), 'Dismiss', { duration: 6000 });
      }
    });
  }

  private describe(err: unknown): string {
    const fields = Object.values(fieldErrors(err));
    return fields.length ? fields.join(' ') : errorMessage(err);
  }

  private load(masjid: Masjid): void {
    this.masjid.set(masjid);
    this.details = buildDetailsForm(this.fb, masjid);
    this.iqama = SALAH.map(({ key, label }) => {
      const rule = masjid.iqama[key];
      return {
        key,
        label,
        mode: rule?.mode ?? 'none',
        time: rule?.mode === 'fixed' ? rule.time : '',
        minutes: rule?.mode === 'offset' ? rule.minutes : 15
      };
    });
    this.jumuah = [...masjid.jumuah];
    this.widget = { ...masjid.widget };
  }
}

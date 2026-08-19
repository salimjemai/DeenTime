import { Injectable, signal } from '@angular/core';

export type HelpTone = 'emerald' | 'sky' | 'gold' | 'coral' | 'plum' | 'teal' | 'navy';

export interface HelpTab {
  path: string;
  label: string;
  icon: string;
  phase: 'SET UP' | 'KEEP CURRENT' | 'PUBLISH';
  headline: string;
  summary: string;
  proTip: string;
  outcome: string;
  tone: HelpTone;
  actions: string[];
}

export const HELP_TABS: readonly HelpTab[] = [
  {
    path: 'profile',
    label: 'Profile',
    icon: 'domain',
    phase: 'SET UP',
    headline: 'Tell IqamaTime about your masjid',
    summary: 'Save the mosque identity, location, timezone, contacts, and prayer calculation method.',
    proTip: 'Complete Profile first. Prayer Times depends on its location, timezone, and calculation settings.',
    outcome: 'A trustworthy foundation for every calculation and public view.',
    tone: 'emerald',
    actions: ['Add masjid details', 'Set calculation criteria', 'Confirm the timezone']
  },
  {
    path: 'timings',
    label: 'Prayer Times',
    icon: 'schedule',
    phase: 'KEEP CURRENT',
    headline: 'Review automatically calculated Adhan times',
    summary: 'See Fajr, Sunrise, Dhuhr, Asr, Maghrib, and Isha for any selected date.',
    proTip: 'These are prayer start times. Use Iqama to set the separate congregation times for your masjid.',
    outcome: 'Accurate daily prayer starts in the masjid’s configured timezone.',
    tone: 'sky',
    actions: ['Choose a date', 'Review each prayer', 'Verify calculation settings']
  },
  {
    path: 'iqama',
    label: 'Iqama',
    icon: 'mosque',
    phase: 'KEEP CURRENT',
    headline: 'Set this masjid’s congregation times',
    summary: 'Manage five daily Iqama times, effective dates, recurring changes, and up to four Jumu’ah services.',
    proTip: 'Use an effective date for seasonal changes. Maghrib can also be stored as minutes after sunset.',
    outcome: 'The latest schedule automatically reaches TV displays and widgets.',
    tone: 'gold',
    actions: ['Fast-edit daily times', 'Schedule a future change', 'Manage Jumu’ah services']
  },
  {
    path: 'design',
    label: 'Design',
    icon: 'palette',
    phase: 'SET UP',
    headline: 'Create one recognizable public look',
    summary: 'Upload the shared background and choose the theme, schedule headings, and footer.',
    proTip: 'One uploaded background is immediately reused by the TV display, full widget, and compact widget.',
    outcome: 'Every public surface feels connected to the same masjid.',
    tone: 'coral',
    actions: ['Upload artwork', 'Select a theme', 'Preview every output']
  },
  {
    path: 'hijri',
    label: 'Hijri',
    icon: 'calendar_month',
    phase: 'KEEP CURRENT',
    headline: 'Keep the local Islamic date accurate',
    summary: 'Map the Hijri date for each Gregorian month, make local adjustments, and lock confirmed months.',
    proTip: 'Lock a month after it is confirmed so regeneration cannot overwrite the community-approved date.',
    outcome: 'Consistent Hijri dates across schedules, displays, and widgets.',
    tone: 'plum',
    actions: ['Review each month', 'Adjust when needed', 'Lock confirmed dates']
  },
  {
    path: 'content',
    label: 'Content',
    icon: 'auto_stories',
    phase: 'KEEP CURRENT',
    headline: 'Explore the shared Islamic library',
    summary: 'Preview Qur’an text and recitation, search multilingual Hadith, and review developer API examples.',
    proTip: 'Provider imports maintain the shared platform library; ordinary masjid work should focus on browsing and publishing content.',
    outcome: 'Reliable Islamic content ready for websites, apps, kiosks, and future display playlists.',
    tone: 'teal',
    actions: ['Preview Qur’an', 'Search Hadith', 'Review API capabilities']
  },
  {
    path: 'publish',
    label: 'Publish',
    icon: 'campaign',
    phase: 'PUBLISH',
    headline: 'Send the finished experience everywhere',
    summary: 'Open live views, copy embed code, configure the TV, and generate monthly, yearly, or Ramadan schedules.',
    proTip: 'Check the live preview after changing Iqama or Design, then copy the widget code into the masjid website.',
    outcome: 'TV displays, widgets, PDFs, websites, and apps stay synchronized.',
    tone: 'navy',
    actions: ['Review live previews', 'Copy website embeds', 'Generate printable PDFs']
  }
];

@Injectable({ providedIn: 'root' })
export class HelpTipsService {
  private readonly enabledKey = 'deentime.help.tips-enabled.v1';
  private readonly welcomeKey = 'deentime.help.welcome-seen.v1';
  private readonly dismissedKey = 'deentime.help.dismissed-tips.v1';

  readonly tipsEnabled = signal(this.read(this.enabledKey) !== 'false');
  readonly welcomeSeen = signal(this.read(this.welcomeKey) === 'true');
  readonly dismissedTips = signal<ReadonlySet<string>>(new Set(this.readList(this.dismissedKey)));

  tab(path: string): HelpTab | undefined {
    return HELP_TABS.find(tab => tab.path === path);
  }

  setTipsEnabled(enabled: boolean) {
    this.tipsEnabled.set(enabled);
    this.write(this.enabledKey, String(enabled));
  }

  markWelcomeSeen() {
    this.welcomeSeen.set(true);
    this.write(this.welcomeKey, 'true');
  }

  dismiss(path: string) {
    const next = new Set(this.dismissedTips());
    next.add(path);
    this.dismissedTips.set(next);
    this.write(this.dismissedKey, JSON.stringify([...next]));
  }

  reset() {
    this.tipsEnabled.set(true);
    this.welcomeSeen.set(false);
    this.dismissedTips.set(new Set());
    this.write(this.enabledKey, 'true');
    this.remove(this.welcomeKey);
    this.remove(this.dismissedKey);
  }

  private read(key: string): string | null {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private readList(key: string): string[] {
    const stored = this.read(key);
    if (!stored) return [];
    try {
      const value: unknown = JSON.parse(stored);
      return Array.isArray(value) && value.every(item => typeof item === 'string') ? value : [];
    } catch {
      return [];
    }
  }

  private write(key: string, value: string) {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
    } catch {
      // Guidance remains available even when browser storage is disabled.
    }
  }

  private remove(key: string) {
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
    } catch {
      // Nothing to reset when browser storage is unavailable.
    }
  }
}

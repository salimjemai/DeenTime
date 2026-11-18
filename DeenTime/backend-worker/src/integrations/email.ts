import type { AppConfig } from '../core/config.js';
import { EmailDeliveryError, EmailNotConfiguredError } from './errors.js';

/** One outgoing message (the subset of nodemailer's options backend-node uses). */
export interface EmailMessage {
  from: { name: string; address: string };
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
}

/** Anything that can deliver an EmailMessage. It must reject when the message was not accepted. */
export interface EmailTransport {
  sendMail(options: EmailMessage): Promise<unknown>;
}

export interface EmailSenderLogger {
  log(message: string): void;
  error(message: string, stack?: string): void;
}

export interface RegistrationEmailSenderOptions {
  transport?: EmailTransport;
  logger?: EmailSenderLogger;
}

const SEND_TIMEOUT_MS = 20_000;

interface EmailDeliverySettings {
  enabled: boolean;
  logLinksWhenDisabled: boolean;
  apiKey: string;
  fromAddress: string;
  fromName: string;
  replyTo: string;
}

/**
 * System.Text.Encodings.Web.HtmlEncoder.Default: printable Basic Latin passes through
 * except & < > " ' and +; everything else (controls, non-ASCII) becomes a numeric entity.
 */
export function htmlEncode(value: string): string {
  let encoded = '';
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0;
    switch (codePoint) {
      case 0x26:
        encoded += '&amp;';
        break;
      case 0x3c:
        encoded += '&lt;';
        break;
      case 0x3e:
        encoded += '&gt;';
        break;
      case 0x22:
        encoded += '&quot;';
        break;
      default:
        encoded += codePoint === 0x27 || codePoint === 0x2b || codePoint < 0x20 || codePoint > 0x7e ? `&#x${codePoint.toString(16).toUpperCase()};` : char;
    }
  }
  return encoded;
}

export interface ResendTransportOptions {
  fetch?: typeof fetch;
  baseUrl?: string;
}

/** RFC 5322 mailbox: `Name <address>`, quoting the display name when it needs it. */
export function formatMailbox(name: string, address: string): string {
  const display = name.trim();
  if (display === '') return address;
  const safe = /^[A-Za-z0-9 !#$%&'*+\-/=?^_`{|}~]+$/.test(display) ? display : `"${display.replace(/[\\"]/g, '\\$&').replace(/[\r\n]+/g, ' ')}"`;
  return `${safe} <${address}>`;
}

/**
 * Delivery through Resend's REST API (SMTP sockets are not available on Workers):
 * POST https://api.resend.com/emails with a bearer key. Any network failure, timeout or
 * non-2xx answer rejects, which the sender reports as EmailDeliveryError (a 503 to the caller),
 * the way backend-node fails when its SMTP server is unreachable.
 */
export class ResendTransport implements EmailTransport {
  static readonly DEFAULT_BASE_URL = 'https://api.resend.com/';

  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly apiKey: string,
    options: ResendTransportOptions = {},
  ) {
    this.baseUrl = `${(options.baseUrl ?? ResendTransport.DEFAULT_BASE_URL).replace(/\/+$/, '')}/`;
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  }

  async sendMail(message: EmailMessage): Promise<unknown> {
    const payload: Record<string, unknown> = {
      from: formatMailbox(message.from.name, message.from.address),
      to: [message.to],
      subject: message.subject,
      html: message.html,
    };
    if (message.replyTo !== undefined) payload.reply_to = message.replyTo;

    const response = await this.fetchImpl(`${this.baseUrl}emails`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!response.ok) {
      // Resend's error body is { statusCode, name, message }; it never echoes the key.
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      throw new Error(`Resend responded with HTTP ${response.status}${detail ? `: ${detail}` : '.'}`);
    }
    return response.json().catch(() => null);
  }
}

const consoleLogger: EmailSenderLogger = {
  log: (message) => console.log(message),
  error: (message, stack) => console.error(message, stack ?? ''),
};

/**
 * Port of backend-node's RegistrationEmailSender (CyberPanelEmailSender). Options:
 * EmailDelivery:Enabled, LogLinksWhenDisabled, ApiKey (Resend), FromAddress, FromName,
 * ReplyTo, and Support:Email. When delivery is disabled the links are logged in
 * Development or when EmailDelivery:LogLinksWhenDisabled is set; otherwise
 * EmailNotConfiguredError. The SMTP settings (Host, Port, UseSsl, Username, Password) are
 * not read here.
 */
export class RegistrationEmailSender {
  private readonly settings: EmailDeliverySettings;
  private readonly supportEmail: string;
  private readonly development: boolean;
  private readonly logger: EmailSenderLogger;
  private transport: EmailTransport | undefined;

  constructor(config: AppConfig, options: RegistrationEmailSenderOptions = {}) {
    this.settings = {
      enabled: config.getBoolean('EmailDelivery:Enabled'),
      logLinksWhenDisabled: config.getBoolean('EmailDelivery:LogLinksWhenDisabled'),
      apiKey: config.get('EmailDelivery:ApiKey') ?? '',
      fromAddress: config.get('EmailDelivery:FromAddress') ?? '',
      fromName: config.get('EmailDelivery:FromName') ?? 'MasjidHub',
      replyTo: config.get('EmailDelivery:ReplyTo') ?? '',
    };
    if (this.settings.enabled && !this.hasCredentials()) {
      // backend-node refuses to start (ValidateOnStart); here the first request that sends email fails.
      throw new Error('Email API key and sender are required when email delivery is enabled.');
    }
    this.supportEmail = (config.get('Support:Email') ?? '').trim();
    this.development = config.isDevelopment();
    this.logger = options.logger ?? consoleLogger;
    this.transport = options.transport;
  }

  get enabled(): boolean {
    return this.settings.enabled;
  }

  async sendVerification(email: string, organizationName: string, verificationUrl: string): Promise<void> {
    if (!this.settings.enabled) {
      this.handleDisabled(`Email delivery disabled; verification URL for ${email}: ${verificationUrl}`);
      return;
    }
    await this.send(
      email,
      'Verify your MasjidHub administrator account',
      `<p>Assalamu alaikum,</p><p>Confirm your administrator account for <strong>${htmlEncode(organizationName)}</strong>.</p><p><a href="${htmlEncode(verificationUrl)}">Verify email and activate the masjid</a></p><p>This link expires in 30 minutes. After verifying, sign in with the password you chose to open your masjid dashboard.</p>${this.supportLine}`,
    );
  }

  async sendInvitation(email: string, organizationName: string, invitationUrl: string): Promise<void> {
    if (!this.settings.enabled) {
      this.handleDisabled(`Email delivery disabled; invitation URL for ${email}: ${invitationUrl}`);
      return;
    }
    await this.send(
      email,
      'You are invited to register your masjid with MasjidHub',
      `<p>Assalamu alaikum,</p><p>MasjidHub has invited you to register <strong>${htmlEncode(organizationName)}</strong>.</p><p><a href="${htmlEncode(invitationUrl)}">Start secure masjid registration</a></p><p>You will create a password, complete the masjid details, and verify this email address; then sign in to open your masjid dashboard. This invitation expires in 7 days.</p>${this.supportLine}`,
    );
  }

  async sendPasswordReset(email: string, resetUrl: string): Promise<void> {
    if (!this.settings.enabled) {
      this.handleDisabled(`Email delivery disabled; password reset URL for ${email}: ${resetUrl}`);
      return;
    }
    await this.send(
      email,
      'Reset your MasjidHub password',
      `<p>Assalamu alaikum,</p><p>A password reset was requested for your MasjidHub administrator account.</p><p><a href="${htmlEncode(resetUrl)}">Choose a new password</a></p><p>This link expires in 30 minutes. If you did not request it, you can ignore this email; your password will not change.</p>`,
    );
  }

  private get supportLine(): string {
    if (this.supportEmail === '') return '';
    const encoded = htmlEncode(this.supportEmail);
    return `<p>Questions? Contact the MasjidHub administrator at <a href="mailto:${encoded}">${encoded}</a>.</p>`;
  }

  private handleDisabled(logMessage: string): void {
    if (this.development || this.settings.logLinksWhenDisabled) {
      this.logger.log(logMessage);
      return;
    }
    throw new EmailNotConfiguredError('Email delivery is not configured.');
  }

  private hasCredentials(): boolean {
    return this.settings.apiKey.trim() !== '' && this.settings.fromAddress.trim() !== '';
  }

  private async send(email: string, subject: string, html: string): Promise<void> {
    if (!this.hasCredentials()) throw new EmailNotConfiguredError('Email delivery is enabled but its credentials are incomplete.');
    const message: EmailMessage = {
      from: { name: this.settings.fromName, address: this.settings.fromAddress },
      to: email,
      subject,
      html,
    };
    if (this.settings.replyTo.trim() !== '') message.replyTo = this.settings.replyTo;

    try {
      await this.getTransport().sendMail(message);
    } catch (error) {
      this.logger.error('Email delivery failed.', error instanceof Error ? (error.stack ?? error.message) : String(error));
      throw new EmailDeliveryError('Email could not be sent.', { cause: error });
    }
  }

  private getTransport(): EmailTransport {
    this.transport ??= new ResendTransport(this.settings.apiKey);
    return this.transport;
  }
}

const instances = new WeakMap<AppConfig, RegistrationEmailSender>();

/**
 * The isolate-wide sender (backend-node's singleton provider): `registrationEmailSender(config(c))`.
 * Throws when EmailDelivery:Enabled is set without ApiKey and FromAddress, where backend-node refuses to start.
 */
export function registrationEmailSender(config: AppConfig): RegistrationEmailSender {
  let sender = instances.get(config);
  if (!sender) {
    sender = new RegistrationEmailSender(config);
    instances.set(config, sender);
  }
  return sender;
}

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import { AppConfig } from '../config/configuration.js';
import { EmailDeliveryError, EmailNotConfiguredError } from './errors.js';

/** The subset of nodemailer's message options the sender uses (MailMessage in .NET). */
export interface EmailMessage {
  from: { name: string; address: string };
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
}

/** Anything that can deliver an EmailMessage; nodemailer's Transporter satisfies it. */
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

/** Optional DI token for RegistrationEmailSenderOptions (never registered in production; tests may provide a transport). */
export const EMAIL_SENDER_OPTIONS = Symbol('EMAIL_SENDER_OPTIONS');

const SMTP_TIMEOUT_MS = 20_000;

interface EmailDeliverySettings {
  enabled: boolean;
  logLinksWhenDisabled: boolean;
  host: string;
  port: number;
  useSsl: boolean;
  username: string;
  password: string;
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

/**
 * Port of CyberPanelEmailSender (IRegistrationEmailSender). Options: EmailDelivery:*
 * and Support:Email. When delivery is disabled the links are logged in Development or
 * when EmailDelivery:LogLinksWhenDisabled is set; otherwise EmailNotConfiguredError.
 */
@Injectable()
export class RegistrationEmailSender {
  private readonly settings: EmailDeliverySettings;
  private readonly supportEmail: string;
  private readonly development: boolean;
  private readonly logger: EmailSenderLogger;
  private transport: EmailTransport | undefined;

  constructor(config: AppConfig, @Optional() @Inject(EMAIL_SENDER_OPTIONS) options: RegistrationEmailSenderOptions = {}) {
    this.settings = {
      enabled: config.getBoolean('EmailDelivery:Enabled'),
      logLinksWhenDisabled: config.getBoolean('EmailDelivery:LogLinksWhenDisabled'),
      host: config.get('EmailDelivery:Host') ?? '',
      port: config.getInt('EmailDelivery:Port', 587),
      useSsl: config.getBoolean('EmailDelivery:UseSsl', true),
      username: config.get('EmailDelivery:Username') ?? '',
      password: config.get('EmailDelivery:Password') ?? '',
      fromAddress: config.get('EmailDelivery:FromAddress') ?? '',
      fromName: config.get('EmailDelivery:FromName') ?? 'IqamaTime',
      replyTo: config.get('EmailDelivery:ReplyTo') ?? '',
    };
    if (this.settings.enabled && !this.hasCredentials()) {
      // AddOptions<EmailDeliveryOptions>().Validate(...).ValidateOnStart() in Program.cs.
      throw new Error('CyberPanel SMTP host, username, password, and sender are required when email delivery is enabled.');
    }
    this.supportEmail = (config.get('Support:Email') ?? '').trim();
    this.development = config.isDevelopment();
    this.logger = options.logger ?? new Logger(RegistrationEmailSender.name);
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
      'Verify your IqamaTime administrator account',
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
      'You are invited to register your masjid with IqamaTime',
      `<p>Assalamu alaikum,</p><p>IqamaTime has invited you to register <strong>${htmlEncode(organizationName)}</strong>.</p><p><a href="${htmlEncode(invitationUrl)}">Start secure masjid registration</a></p><p>You will create a password, complete the masjid details, and verify this email address; then sign in to open your masjid dashboard. This invitation expires in 7 days.</p>${this.supportLine}`,
    );
  }

  async sendPasswordReset(email: string, resetUrl: string): Promise<void> {
    if (!this.settings.enabled) {
      this.handleDisabled(`Email delivery disabled; password reset URL for ${email}: ${resetUrl}`);
      return;
    }
    await this.send(
      email,
      'Reset your IqamaTime password',
      `<p>Assalamu alaikum,</p><p>A password reset was requested for your IqamaTime administrator account.</p><p><a href="${htmlEncode(resetUrl)}">Choose a new password</a></p><p>This link expires in 30 minutes. If you did not request it, you can ignore this email; your password will not change.</p>`,
    );
  }

  private get supportLine(): string {
    if (this.supportEmail === '') return '';
    const encoded = htmlEncode(this.supportEmail);
    return `<p>Questions? Contact the IqamaTime administrator at <a href="mailto:${encoded}">${encoded}</a>.</p>`;
  }

  private handleDisabled(logMessage: string): void {
    if (this.development || this.settings.logLinksWhenDisabled) {
      this.logger.log(logMessage);
      return;
    }
    throw new EmailNotConfiguredError('Email delivery is not configured.');
  }

  private hasCredentials(): boolean {
    const { host, username, password, fromAddress } = this.settings;
    return host.trim() !== '' && username.trim() !== '' && password.trim() !== '' && fromAddress.trim() !== '';
  }

  private async send(email: string, subject: string, html: string): Promise<void> {
    if (!this.hasCredentials()) throw new EmailNotConfiguredError('CyberPanel SMTP delivery is enabled but its credentials are incomplete.');
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
      this.logger.error('CyberPanel SMTP email delivery failed.', error instanceof Error ? error.stack : String(error));
      throw new EmailDeliveryError('Email could not be sent.', { cause: error });
    }
  }

  private getTransport(): EmailTransport {
    if (this.transport === undefined) {
      const { host, port, useSsl, username, password } = this.settings;
      // System.Net.Mail.SmtpClient.EnableSsl means STARTTLS (it has no implicit-TLS mode);
      // nodemailer needs `secure` for implicit TLS on 465 and `requireTLS` for STARTTLS elsewhere.
      this.transport = createTransport({
        host,
        port,
        secure: useSsl && port === 465,
        requireTLS: useSsl && port !== 465,
        auth: { user: username, pass: password },
        connectionTimeout: SMTP_TIMEOUT_MS,
        greetingTimeout: SMTP_TIMEOUT_MS,
        socketTimeout: SMTP_TIMEOUT_MS,
      });
    }
    return this.transport;
  }
}

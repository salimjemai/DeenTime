import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { AppConfig } from '../config/configuration.js';
import { EmailDeliveryError, EmailNotConfiguredError } from './errors.js';
import { RegistrationEmailSender, htmlEncode, type EmailMessage } from './email.service.js';

function testConfig(overrides: Record<string, string>, environmentName: string): AppConfig {
  return AppConfig.load({ contentRoot: tmpdir(), env: {}, overrides, environmentName });
}

function fakeLogger(): { logs: string[]; errors: string[]; log(message: string): void; error(message: string): void } {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    logs,
    errors,
    log: (message) => {
      logs.push(message);
    },
    error: (message) => {
      errors.push(message);
    },
  };
}

function fakeTransport(fail?: Error): { sent: EmailMessage[]; sendMail(options: EmailMessage): Promise<unknown> } {
  const sent: EmailMessage[] = [];
  return {
    sent,
    sendMail: async (options) => {
      if (fail) throw fail;
      sent.push(options);
      return { messageId: 'stub' };
    },
  };
}

const enabledSettings = {
  'EmailDelivery:Enabled': 'true',
  'EmailDelivery:Host': 'mail.iqamatime.test',
  'EmailDelivery:Username': 'noreply@iqamatime.test',
  'EmailDelivery:Password': 'secret',
  'EmailDelivery:FromAddress': 'noreply@iqamatime.test',
  'Support:Email': ' support@iqamatime.test ',
};

const supportLine = '<p>Questions? Contact the IqamaTime administrator at <a href="mailto:support@iqamatime.test">support@iqamatime.test</a>.</p>';

describe('htmlEncode', () => {
  it('encodes like HtmlEncoder.Default', () => {
    expect(htmlEncode(`Masjid <Al-Noor> & "Friends" 'Center' 1+1`)).toBe('Masjid &lt;Al-Noor&gt; &amp; &quot;Friends&quot; &#x27;Center&#x27; 1&#x2B;1');
    expect(htmlEncode('https://app.test/verify?token=a-b_c.d~e/f')).toBe('https://app.test/verify?token=a-b_c.d~e/f');
    expect(htmlEncode('Café مسجد\n😀')).toBe('Caf&#xE9; &#x645;&#x633;&#x62C;&#x62F;&#xA;&#x1F600;');
  });
});

describe('RegistrationEmailSender when delivery is disabled', () => {
  it('logs the links in Development and does not throw', async () => {
    const logger = fakeLogger();
    const transport = fakeTransport();
    const sender = new RegistrationEmailSender(testConfig({ 'EmailDelivery:Enabled': 'false' }, 'Development'), { transport, logger });

    expect(sender.enabled).toBe(false);
    await sender.sendVerification('imam@masjid.test', 'Masjid', 'https://app.test/verify?token=1');
    await sender.sendInvitation('imam@masjid.test', 'Masjid', 'https://app.test/register?invite=2');
    await sender.sendPasswordReset('imam@masjid.test', 'https://app.test/reset?token=3');

    expect(logger.logs).toEqual([
      'Email delivery disabled; verification URL for imam@masjid.test: https://app.test/verify?token=1',
      'Email delivery disabled; invitation URL for imam@masjid.test: https://app.test/register?invite=2',
      'Email delivery disabled; password reset URL for imam@masjid.test: https://app.test/reset?token=3',
    ]);
    expect(transport.sent).toHaveLength(0);
  });

  it('throws EmailNotConfiguredError in Production', async () => {
    const logger = fakeLogger();
    const sender = new RegistrationEmailSender(testConfig({}, 'Production'), { transport: fakeTransport(), logger });

    await expect(sender.sendVerification('imam@masjid.test', 'Masjid', 'https://app.test/verify')).rejects.toBeInstanceOf(EmailNotConfiguredError);
    await expect(sender.sendInvitation('imam@masjid.test', 'Masjid', 'https://app.test/register')).rejects.toThrow('Email delivery is not configured.');
    await expect(sender.sendPasswordReset('imam@masjid.test', 'https://app.test/reset')).rejects.toThrow('Email delivery is not configured.');
    expect(logger.logs).toHaveLength(0);
  });

  it('logs the links in Production when LogLinksWhenDisabled is set', async () => {
    const logger = fakeLogger();
    const sender = new RegistrationEmailSender(testConfig({ 'EmailDelivery:LogLinksWhenDisabled': 'true' }, 'Production'), { logger });
    await sender.sendPasswordReset('imam@masjid.test', 'https://app.test/reset?token=3');
    expect(logger.logs).toEqual(['Email delivery disabled; password reset URL for imam@masjid.test: https://app.test/reset?token=3']);
  });
});

describe('RegistrationEmailSender when delivery is enabled', () => {
  it('sends the verification email with the exact .NET subject and body', async () => {
    const transport = fakeTransport();
    const sender = new RegistrationEmailSender(testConfig(enabledSettings, 'Production'), { transport, logger: fakeLogger() });

    expect(sender.enabled).toBe(true);
    await sender.sendVerification('imam@masjid.test', 'Masjid <Al-Noor> & Co', 'https://app.test/verify?token=abc+def');

    expect(transport.sent).toEqual([
      {
        from: { name: 'IqamaTime', address: 'noreply@iqamatime.test' },
        to: 'imam@masjid.test',
        subject: 'Verify your IqamaTime administrator account',
        html:
          '<p>Assalamu alaikum,</p><p>Confirm your administrator account for <strong>Masjid &lt;Al-Noor&gt; &amp; Co</strong>.</p>' +
          '<p><a href="https://app.test/verify?token=abc&#x2B;def">Verify email and activate the masjid</a></p>' +
          '<p>This link expires in 30 minutes. After verifying, sign in with the password you chose to open your masjid dashboard.</p>' +
          supportLine,
      },
    ]);
  });

  it('sends the invitation email with the exact .NET subject and body', async () => {
    const transport = fakeTransport();
    const sender = new RegistrationEmailSender(testConfig({ ...enabledSettings, 'EmailDelivery:ReplyTo': 'admin@iqamatime.test', 'EmailDelivery:FromName': 'IqamaTime Admin' }, 'Production'), {
      transport,
      logger: fakeLogger(),
    });

    await sender.sendInvitation('imam@masjid.test', "Masjid 'Al-Noor'", 'https://app.test/register?invite=xyz');

    expect(transport.sent).toEqual([
      {
        from: { name: 'IqamaTime Admin', address: 'noreply@iqamatime.test' },
        to: 'imam@masjid.test',
        replyTo: 'admin@iqamatime.test',
        subject: 'You are invited to register your masjid with IqamaTime',
        html:
          '<p>Assalamu alaikum,</p><p>IqamaTime has invited you to register <strong>Masjid &#x27;Al-Noor&#x27;</strong>.</p>' +
          '<p><a href="https://app.test/register?invite=xyz">Start secure masjid registration</a></p>' +
          '<p>You will create a password, complete the masjid details, and verify this email address; then sign in to open your masjid dashboard. This invitation expires in 7 days.</p>' +
          supportLine,
      },
    ]);
  });

  it('sends the password reset email without the support line', async () => {
    const transport = fakeTransport();
    const sender = new RegistrationEmailSender(testConfig(enabledSettings, 'Production'), { transport, logger: fakeLogger() });

    await sender.sendPasswordReset('imam@masjid.test', 'https://app.test/reset?token="q"');

    expect(transport.sent[0].subject).toBe('Reset your IqamaTime password');
    expect(transport.sent[0].html).toBe(
      '<p>Assalamu alaikum,</p><p>A password reset was requested for your IqamaTime administrator account.</p>' +
        '<p><a href="https://app.test/reset?token=&quot;q&quot;">Choose a new password</a></p>' +
        '<p>This link expires in 30 minutes. If you did not request it, you can ignore this email; your password will not change.</p>',
    );
    expect(transport.sent[0].replyTo).toBeUndefined();
  });

  it('omits the support line when Support:Email is blank', async () => {
    const transport = fakeTransport();
    const sender = new RegistrationEmailSender(testConfig({ ...enabledSettings, 'Support:Email': '  ' }, 'Production'), { transport, logger: fakeLogger() });
    await sender.sendVerification('imam@masjid.test', 'Masjid', 'https://app.test/verify');
    expect(transport.sent[0].html.endsWith('open your masjid dashboard.</p>')).toBe(true);
  });

  it('wraps transport failures in EmailDeliveryError and logs them', async () => {
    const logger = fakeLogger();
    const sender = new RegistrationEmailSender(testConfig(enabledSettings, 'Production'), { transport: fakeTransport(new Error('ECONNREFUSED')), logger });

    await expect(sender.sendVerification('imam@masjid.test', 'Masjid', 'https://app.test/verify')).rejects.toBeInstanceOf(EmailDeliveryError);
    await expect(sender.sendVerification('imam@masjid.test', 'Masjid', 'https://app.test/verify')).rejects.toThrow('Email could not be sent.');
    expect(logger.errors).toEqual(['CyberPanel SMTP email delivery failed.', 'CyberPanel SMTP email delivery failed.']);
  });

  it('fails at construction when enabled with incomplete credentials (ValidateOnStart)', () => {
    expect(() => new RegistrationEmailSender(testConfig({ ...enabledSettings, 'EmailDelivery:Password': '' }, 'Production'))).toThrow(
      'CyberPanel SMTP host, username, password, and sender are required when email delivery is enabled.',
    );
  });
});

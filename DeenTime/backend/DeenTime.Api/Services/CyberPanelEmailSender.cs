using System.Net;
using System.Net.Mail;
using System.Text;
using System.Text.Encodings.Web;
using Microsoft.Extensions.Options;

namespace DeenTime.Api.Services;

public sealed class EmailDeliveryOptions
{
    public const string SectionName = "EmailDelivery";
    public bool Enabled { get; set; }
    public string Host { get; set; } = "";
    public int Port { get; set; } = 587;
    public bool UseSsl { get; set; } = true;
    public string Username { get; set; } = "";
    public string Password { get; set; } = "";
    public string FromAddress { get; set; } = "";
    public string FromName { get; set; } = "IqamaTime";
    public string? ReplyTo { get; set; }
}

public interface IRegistrationEmailSender
{
    Task SendVerificationAsync(string email, string organizationName, string verificationUrl, CancellationToken cancellationToken);
    Task SendInvitationAsync(string email, string organizationName, string invitationUrl, CancellationToken cancellationToken);
}

public sealed class CyberPanelEmailSender(
    IOptions<EmailDeliveryOptions> options,
    IWebHostEnvironment environment,
    ILogger<CyberPanelEmailSender> logger) : IRegistrationEmailSender
{
    private readonly EmailDeliveryOptions settings = options.Value;

    public async Task SendVerificationAsync(string email, string organizationName, string verificationUrl, CancellationToken cancellationToken)
    {
        if (!settings.Enabled)
        {
            if (environment.IsDevelopment())
            {
                logger.LogInformation("Development email verification URL: {VerificationUrl}", verificationUrl);
                return;
            }
            throw new InvalidOperationException("Email delivery is not configured.");
        }

        await SendAsync(
            email,
            "Verify your IqamaTime administrator account",
            $"<p>Assalamu alaikum,</p><p>Confirm your administrator account for <strong>{HtmlEncoder.Default.Encode(organizationName)}</strong>.</p><p><a href=\"{HtmlEncoder.Default.Encode(verificationUrl)}\">Verify email and activate the masjid</a></p><p>This link expires in 30 minutes.</p>",
            cancellationToken);
    }

    public async Task SendInvitationAsync(string email, string organizationName, string invitationUrl, CancellationToken cancellationToken)
    {
        if (!settings.Enabled)
        {
            if (environment.IsDevelopment())
            {
                logger.LogInformation("Development masjid invitation URL: {InvitationUrl}", invitationUrl);
                return;
            }
            throw new InvalidOperationException("Email delivery is not configured.");
        }

        await SendAsync(
            email,
            "You are invited to register your masjid with IqamaTime",
            $"<p>Assalamu alaikum,</p><p>IqamaTime has invited you to register <strong>{HtmlEncoder.Default.Encode(organizationName)}</strong>.</p><p><a href=\"{HtmlEncoder.Default.Encode(invitationUrl)}\">Start secure masjid registration</a></p><p>You will still create a password, complete the security check, and verify this email address. This invitation expires in 7 days.</p>",
            cancellationToken);
    }

    private async Task SendAsync(string email, string subject, string body, CancellationToken cancellationToken)
    {

        if (string.IsNullOrWhiteSpace(settings.Host) || string.IsNullOrWhiteSpace(settings.Username) ||
            string.IsNullOrWhiteSpace(settings.Password) || string.IsNullOrWhiteSpace(settings.FromAddress))
            throw new InvalidOperationException("CyberPanel SMTP delivery is enabled but its credentials are incomplete.");

        using var message = new MailMessage
        {
            From = new MailAddress(settings.FromAddress, settings.FromName, Encoding.UTF8),
            Subject = subject,
            Body = body,
            IsBodyHtml = true,
            BodyEncoding = Encoding.UTF8,
            SubjectEncoding = Encoding.UTF8
        };
        message.To.Add(new MailAddress(email));
        if (!string.IsNullOrWhiteSpace(settings.ReplyTo)) message.ReplyToList.Add(new MailAddress(settings.ReplyTo));

        using var client = new SmtpClient(settings.Host, settings.Port)
        {
            EnableSsl = settings.UseSsl,
            UseDefaultCredentials = false,
            Credentials = new NetworkCredential(settings.Username, settings.Password),
            DeliveryMethod = SmtpDeliveryMethod.Network,
            Timeout = 20_000
        };

        cancellationToken.ThrowIfCancellationRequested();
        try
        {
            await client.SendMailAsync(message, cancellationToken);
        }
        catch (SmtpException exception)
        {
            logger.LogError(exception, "CyberPanel SMTP email delivery failed.");
            throw new HttpRequestException("Email could not be sent.", exception);
        }
    }
}

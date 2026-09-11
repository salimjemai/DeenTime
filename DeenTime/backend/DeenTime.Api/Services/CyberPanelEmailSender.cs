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
    /// <summary>
    /// When delivery is disabled, log verification and invitation links instead of
    /// failing. Development does this automatically; set this for a staging server
    /// that has no mail server so accounts can be activated from the API log.
    /// </summary>
    public bool LogLinksWhenDisabled { get; set; }
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
    Task SendPasswordResetAsync(string email, string resetUrl, CancellationToken cancellationToken);
}

public sealed class CyberPanelEmailSender(
    IOptions<EmailDeliveryOptions> options,
    IOptions<SupportOptions> support,
    IWebHostEnvironment environment,
    ILogger<CyberPanelEmailSender> logger) : IRegistrationEmailSender
{
    private readonly EmailDeliveryOptions settings = options.Value;

    private bool LinksCanBeLogged => environment.IsDevelopment() || settings.LogLinksWhenDisabled;

    private string SupportLine
    {
        get
        {
            var email = support.Value.Email?.Trim();
            if (string.IsNullOrWhiteSpace(email)) return "";
            var encoded = HtmlEncoder.Default.Encode(email);
            return $"<p>Questions? Contact the IqamaTime administrator at <a href=\"mailto:{encoded}\">{encoded}</a>.</p>";
        }
    }

    public async Task SendVerificationAsync(string email, string organizationName, string verificationUrl, CancellationToken cancellationToken)
    {
        if (!settings.Enabled)
        {
            if (LinksCanBeLogged)
            {
                logger.LogInformation("Email delivery disabled; verification URL for {Email}: {VerificationUrl}", email, verificationUrl);
                return;
            }
            throw new InvalidOperationException("Email delivery is not configured.");
        }

        await SendAsync(
            email,
            "Verify your IqamaTime administrator account",
            $"<p>Assalamu alaikum,</p><p>Confirm your administrator account for <strong>{HtmlEncoder.Default.Encode(organizationName)}</strong>.</p><p><a href=\"{HtmlEncoder.Default.Encode(verificationUrl)}\">Verify email and activate the masjid</a></p><p>This link expires in 30 minutes. After verifying, sign in with the password you chose to open your masjid dashboard.</p>{SupportLine}",
            cancellationToken);
    }

    public async Task SendInvitationAsync(string email, string organizationName, string invitationUrl, CancellationToken cancellationToken)
    {
        if (!settings.Enabled)
        {
            if (LinksCanBeLogged)
            {
                logger.LogInformation("Email delivery disabled; invitation URL for {Email}: {InvitationUrl}", email, invitationUrl);
                return;
            }
            throw new InvalidOperationException("Email delivery is not configured.");
        }

        await SendAsync(
            email,
            "You are invited to register your masjid with IqamaTime",
            $"<p>Assalamu alaikum,</p><p>IqamaTime has invited you to register <strong>{HtmlEncoder.Default.Encode(organizationName)}</strong>.</p><p><a href=\"{HtmlEncoder.Default.Encode(invitationUrl)}\">Start secure masjid registration</a></p><p>You will create a password, complete the masjid details, and verify this email address; then sign in to open your masjid dashboard. This invitation expires in 7 days.</p>{SupportLine}",
            cancellationToken);
    }

    public async Task SendPasswordResetAsync(string email, string resetUrl, CancellationToken cancellationToken)
    {
        if (!settings.Enabled)
        {
            if (LinksCanBeLogged)
            {
                logger.LogInformation("Email delivery disabled; password reset URL for {Email}: {ResetUrl}", email, resetUrl);
                return;
            }
            throw new InvalidOperationException("Email delivery is not configured.");
        }

        await SendAsync(
            email,
            "Reset your IqamaTime password",
            $"<p>Assalamu alaikum,</p><p>A password reset was requested for your IqamaTime administrator account.</p><p><a href=\"{HtmlEncoder.Default.Encode(resetUrl)}\">Choose a new password</a></p><p>This link expires in 30 minutes. If you did not request it, you can ignore this email; your password will not change.</p>",
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

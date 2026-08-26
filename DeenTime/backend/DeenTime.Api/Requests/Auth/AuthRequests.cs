namespace DeenTime.Api.Requests.Auth;

public sealed record RegisterRequest(
    string Email,
    string Password,
    string ConfirmPassword,
    string OrganizationName,
    string WebsiteUrl,
    string AddressLine,
    string City,
    string State,
    string ZipCode,
    string? AddressPlaceId,
    string? CaptchaToken,
    string? InvitationToken = null);
public sealed record LoginRequest(string Email, string Password, string? CaptchaToken);
public sealed record VerifyEmailRequest(string Token);
public sealed record ForgotRequest(string Email);
public sealed record ResetRequest(string Token, string NewPassword);

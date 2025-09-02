namespace DeenTime.Api.Requests.Auth;

public sealed record RegisterRequest(string Email, string Password, string? OrganizationName);
public sealed record LoginRequest(string Email, string Password);
public sealed record ForgotRequest(string Email);
public sealed record ResetRequest(string Token, string NewPassword);



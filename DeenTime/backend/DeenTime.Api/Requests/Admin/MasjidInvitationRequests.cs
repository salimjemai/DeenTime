namespace DeenTime.Api.Requests.Admin;

public sealed record CreateMasjidInvitationRequest(
    string Email,
    string OrganizationName,
    string? WebsiteUrl,
    string? AddressLine,
    string? City,
    string? State,
    string? ZipCode);

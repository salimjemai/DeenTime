namespace DeenTime.Api.Requests.Organizations;

public sealed record OrganizationUpdateRequest(
    string Name,
    string? AddressLine,
    string? City,
    string? State,
    string? ZipCode,
    string? Phone,
    string? WebsiteUrl,
    string? Email,
    string? SocialUrl
);



using DeenTime.Core.Enums;

namespace DeenTime.Api.Requests.Iqama;

public sealed record IqamaUpsertRequest(Guid OrganizationId, DateOnly Date, SalahType Salah, TimeOnly Time, string? Note);



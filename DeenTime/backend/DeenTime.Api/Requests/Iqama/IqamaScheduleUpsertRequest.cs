using DeenTime.Core.Enums;

namespace DeenTime.Api.Requests.Iqama;

public sealed record IqamaScheduleItemRequest(
    SalahType Salah,
    TimeOnly Time,
    string? Note,
    int? OffsetMinutes);

public sealed record IqamaScheduleUpsertRequest(
    Guid OrganizationId,
    DateOnly EffectiveDate,
    IqamaScheduleItemRequest[] Entries);

using DeenTime.Core.Enums;

namespace DeenTime.Api.Requests.Publish;

public sealed record PdfGenerateRequest(Guid OrgId, int Year, int Month, PdfSize Size, PdfOrientation Orientation);



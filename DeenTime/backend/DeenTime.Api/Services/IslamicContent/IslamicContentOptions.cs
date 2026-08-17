namespace DeenTime.Api.Services.IslamicContent;

public sealed class IslamicContentOptions
{
    public const string SectionName = "IslamicContent";
    public const string RequiredQuranBaseUrl = "https://api.alquran.cloud/v1/";

    public string QuranBaseUrl { get; init; } = RequiredQuranBaseUrl;
    public string HadithBaseUrl { get; init; } = "https://hadithapi.com/api/";
    public string HadithApiKey { get; init; } = "";
    public int QuranCacheDays { get; init; } = 30;
}

namespace DeenTime.Api.Services.IslamicContent;

public sealed class IslamicContentOptions
{
    public const string SectionName = "IslamicContent";
    public const string RequiredQuranBaseUrl = "https://api.alquran.cloud/v1/";
    public const string RequiredAlAdhanBaseUrl = "https://api.aladhan.com/v1/";

    public string QuranBaseUrl { get; init; } = RequiredQuranBaseUrl;
    public string AlAdhanBaseUrl { get; init; } = RequiredAlAdhanBaseUrl;
    public string HadithBaseUrl { get; init; } = "https://hadithapi.com/api/";
    public string HadithApiKey { get; init; } = "";
    public int QuranCacheDays { get; init; } = 30;
    public int QiblaCacheDays { get; init; } = 30;
}

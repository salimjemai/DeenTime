namespace DeenTime.Api.Requests.Design;

public sealed record DesignRequest(
    string? HeaderImageUrl,
    string[] IqamaHeadings,
    string? FooterHtml,
    string? Theme,
    int? TvFontScale = null,
    int? WidgetFontScale = null,
    int? CompactFontScale = null,
    string? TvFontFamily = null,
    string? WidgetFontFamily = null,
    string? CompactFontFamily = null);


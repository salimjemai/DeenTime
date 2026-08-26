using DeenTime.Api.Requests.Design;
using FluentValidation;

namespace DeenTime.Api.Validators;

public sealed class DesignRequestValidator : AbstractValidator<DesignRequest>
{
    public DesignRequestValidator()
    {
		RuleFor(x => x.HeaderImageUrl)
			.Must(IsSafeImageUrl)
			.WithMessage("Header image URL must be an HTTPS/HTTP address or a local uploaded image.");
		RuleFor(x => x.FooterHtml).MaximumLength(10_000);
		RuleFor(x => x.IqamaHeadings).NotNull().Must(headings => headings.Length <= 20)
			.WithMessage("At most 20 display headings are allowed.");
		RuleForEach(x => x.IqamaHeadings).MaximumLength(80);
        RuleFor(x => x.Theme).Must(theme => theme is null or "default" or "light" or "dark" or "classic")
            .WithMessage("Theme must be default, dark, or classic.");
        foreach (var scale in new[]
        {
            nameof(DesignRequest.TvFontScale),
            nameof(DesignRequest.WidgetFontScale),
            nameof(DesignRequest.CompactFontScale)
        })
        {
            RuleFor(x => scale == nameof(DesignRequest.TvFontScale) ? x.TvFontScale :
                       scale == nameof(DesignRequest.WidgetFontScale) ? x.WidgetFontScale : x.CompactFontScale)
                .Must(value => value is null || value is >= 75 and <= 160 && value % 5 == 0)
                .WithMessage("Font scale must be between 75 and 160 in increments of 5.");
        }

        RuleFor(x => x.TvFontFamily).Must(IsSupportedFontFamily).WithMessage("TV font family is not supported.");
        RuleFor(x => x.WidgetFontFamily).Must(IsSupportedFontFamily).WithMessage("Widget font family is not supported.");
        RuleFor(x => x.CompactFontFamily).Must(IsSupportedFontFamily).WithMessage("Compact font family is not supported.");
    }

    private static bool IsSupportedFontFamily(string? value) =>
        value is null or "system" or "modern-sans" or "classic-serif";

	private static bool IsSafeImageUrl(string? value)
	{
		if (string.IsNullOrWhiteSpace(value)) return true;
		if (value.StartsWith("/uploads/", StringComparison.Ordinal)) return true;
		return Uri.TryCreate(value, UriKind.Absolute, out var uri) &&
			uri.Scheme is "http" or "https" && string.IsNullOrEmpty(uri.UserInfo);
	}
}

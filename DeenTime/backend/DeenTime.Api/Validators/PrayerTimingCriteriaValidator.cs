using DeenTime.Core.Entities;
using FluentValidation;

namespace DeenTime.Api.Validators;

public sealed class PrayerTimingCriteriaValidator : AbstractValidator<PrayerTimingCriteria>
{
    private static readonly string[] Methods =
        ["ISNA", "MWL", "Egyptian", "Karachi", "UmmAlQura", "Gulf", "Kuwait", "Qatar", "Tehran", "Jafari"];

    public PrayerTimingCriteriaValidator()
    {
        RuleFor(item => item.Method)
            .Must(value => Methods.Contains(value, StringComparer.OrdinalIgnoreCase))
            .WithMessage("Select a supported prayer calculation method.");
        RuleFor(item => item.JuristicMethodAsr)
            .Must(value => string.Equals(value, "Other", StringComparison.OrdinalIgnoreCase) ||
                           string.Equals(value, "Hanafi", StringComparison.OrdinalIgnoreCase))
            .WithMessage("Asr method must be Standard or Hanafi.");
        RuleFor(item => item.Latitude).InclusiveBetween(-90, 90);
        RuleFor(item => item.Longitude).InclusiveBetween(-180, 180);
        RuleFor(item => item.TimezoneId)
            .Cascade(CascadeMode.Stop)
            .NotEmpty()
            .Must(IsTimezone)
            .WithMessage("Select a valid IANA timezone.");
        RuleFor(item => item.ZipCode).MaximumLength(32);
        RuleFor(item => item.MinutesAfterZawal).InclusiveBetween(0, 120);
        RuleFor(item => item.MinutesAfterMaghrib).InclusiveBetween(0, 120);
        RuleFor(item => item.KhutbahTimeMinutes).InclusiveBetween(0, 180);
        RuleFor(item => item.DstEnds)
            .GreaterThan(item => item.DstBegins)
            .When(item => item.DstBegins.HasValue && item.DstEnds.HasValue)
            .WithMessage("DST end must be after DST start.");
    }

    private static bool IsTimezone(string value)
    {
        try
        {
            _ = TimeZoneInfo.FindSystemTimeZoneById(value);
            return true;
        }
        catch (TimeZoneNotFoundException)
        {
            return false;
        }
        catch (InvalidTimeZoneException)
        {
            return false;
        }
    }
}

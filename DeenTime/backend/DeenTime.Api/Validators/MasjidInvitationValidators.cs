using DeenTime.Api.Requests.Admin;
using FluentValidation;

namespace DeenTime.Api.Validators;

public sealed class CreateMasjidInvitationRequestValidator : AbstractValidator<CreateMasjidInvitationRequest>
{
    public CreateMasjidInvitationRequestValidator()
    {
        RuleFor(x => x.Email).NotEmpty().EmailAddress().MaximumLength(320);
        RuleFor(x => x.OrganizationName).NotEmpty().MaximumLength(160);
        RuleFor(x => x.WebsiteUrl).MaximumLength(2048);
        RuleFor(x => x.AddressLine).MaximumLength(240);
        RuleFor(x => x.City).MaximumLength(120);
        RuleFor(x => x.State)
            .Must(value => string.IsNullOrWhiteSpace(value) || value.Trim().Length == 2)
            .WithMessage("State must be a two-letter abbreviation.");
        RuleFor(x => x.ZipCode)
            .Must(value => string.IsNullOrWhiteSpace(value) || System.Text.RegularExpressions.Regex.IsMatch(value.Trim(), @"^\d{5}(?:-\d{4})?$") )
            .WithMessage("Enter a valid U.S. ZIP code.");
    }
}

using DeenTime.Api.Requests.Auth;
using FluentValidation;

namespace DeenTime.Api.Validators;

public sealed class RegisterRequestValidator : AbstractValidator<RegisterRequest>
{
    public RegisterRequestValidator()
    {
        RuleFor(x => x.Email)
            .NotEmpty().EmailAddress().MaximumLength(320)
            .Matches(@"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")
            .WithMessage("Enter a valid email address.");
        RuleFor(x => x.Password)
            .NotEmpty()
            .MinimumLength(12)
            .MaximumLength(128)
            .Matches("[a-z]").WithMessage("Password must include a lowercase letter.")
            .Matches("[A-Z]").WithMessage("Password must include an uppercase letter.")
            .Matches("[0-9]").WithMessage("Password must include a number.")
            .Matches("[^A-Za-z0-9]").WithMessage("Password must include a symbol.")
            .Must(password => password.All(character => !char.IsWhiteSpace(character)))
            .WithMessage("Password cannot contain spaces.");
        RuleFor(x => x.ConfirmPassword).Equal(x => x.Password).WithMessage("Passwords do not match.");
        RuleFor(x => x.OrganizationName).NotEmpty().MaximumLength(160);
        RuleFor(x => x.WebsiteUrl).NotEmpty().MaximumLength(2048);
        RuleFor(x => x.AddressLine).NotEmpty().MaximumLength(240);
        RuleFor(x => x.City).NotEmpty().MaximumLength(120);
        RuleFor(x => x.State).NotEmpty().Length(2);
        RuleFor(x => x.ZipCode).NotEmpty().Matches(@"^\d{5}(?:-\d{4})?$");
        RuleFor(x => x.AddressPlaceId).MaximumLength(512);
        RuleFor(x => x.CaptchaToken).MaximumLength(2048);
        RuleFor(x => x.InvitationToken).MaximumLength(512);
    }
}

public sealed class LoginRequestValidator : AbstractValidator<LoginRequest>
{
    public LoginRequestValidator()
    {
        RuleFor(x => x.Email)
            .NotEmpty().EmailAddress().MaximumLength(320)
            .Matches(@"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")
            .WithMessage("Enter a valid email address.");
        RuleFor(x => x.Password).NotEmpty().MaximumLength(128);
        RuleFor(x => x.CaptchaToken).MaximumLength(2048);
    }
}

public sealed class VerifyEmailRequestValidator : AbstractValidator<VerifyEmailRequest>
{
    public VerifyEmailRequestValidator() => RuleFor(x => x.Token).NotEmpty().MaximumLength(512);
}

public sealed class ForgotRequestValidator : AbstractValidator<ForgotRequest>
{
    public ForgotRequestValidator()
    {
        RuleFor(x => x.Email).NotEmpty().EmailAddress();
    }
}

public sealed class ResetRequestValidator : AbstractValidator<ResetRequest>
{
    public ResetRequestValidator()
    {
        RuleFor(x => x.Token).NotEmpty();
        RuleFor(x => x.NewPassword)
            .NotEmpty()
            .MinimumLength(12)
            .MaximumLength(128)
            .Matches("[a-z]").WithMessage("Password must include a lowercase letter.")
            .Matches("[A-Z]").WithMessage("Password must include an uppercase letter.")
            .Matches("[0-9]").WithMessage("Password must include a number.")
            .Matches("[^A-Za-z0-9]").WithMessage("Password must include a symbol.")
            .Must(password => password.All(character => !char.IsWhiteSpace(character)))
            .WithMessage("Password cannot contain spaces.");
    }
}

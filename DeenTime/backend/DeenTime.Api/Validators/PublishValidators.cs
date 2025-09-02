using DeenTime.Api.Requests.Publish;
using FluentValidation;

namespace DeenTime.Api.Validators;

public sealed class PdfGenerateRequestValidator : AbstractValidator<PdfGenerateRequest>
{
    public PdfGenerateRequestValidator()
    {
        RuleFor(x => x.OrgId).NotEmpty();
        RuleFor(x => x.Year).InclusiveBetween(2000, 2100);
        RuleFor(x => x.Month).InclusiveBetween(1, 12);
    }
}



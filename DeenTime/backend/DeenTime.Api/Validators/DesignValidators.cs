using DeenTime.Api.Requests.Design;
using FluentValidation;

namespace DeenTime.Api.Validators;

public sealed class DesignRequestValidator : AbstractValidator<DesignRequest>
{
    public DesignRequestValidator()
    {
        RuleFor(x => x.Theme).NotEmpty();
        RuleFor(x => x.IqamaHeadings).NotNull();
    }
}



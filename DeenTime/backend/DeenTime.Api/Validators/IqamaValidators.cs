using DeenTime.Api.Requests.Iqama;
using FluentValidation;

namespace DeenTime.Api.Validators;

public sealed class IqamaUpsertRequestValidator : AbstractValidator<IqamaUpsertRequest>
{
    public IqamaUpsertRequestValidator()
    {
        RuleFor(x => x.OrganizationId).NotEmpty();
        RuleFor(x => x.Date).NotEmpty();
        RuleFor(x => x.Time).NotEmpty();
    }
}



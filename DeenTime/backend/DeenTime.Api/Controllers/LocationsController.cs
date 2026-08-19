using DeenTime.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace DeenTime.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/v1/locations")]
public sealed class LocationsController(PostalCodeResolver postalCodes) : ControllerBase
{
    [HttpGet("postal-code/{postalCode}")]
    public async Task<IActionResult> ResolvePostalCode(string postalCode, CancellationToken cancellationToken)
    {
        var normalized = PostalCodeResolver.NormalizeUsPostalCode(postalCode);
        if (normalized is null)
            return BadRequest(new { message = "Enter a valid 5-digit U.S. ZIP code." });

        try
        {
            var location = await postalCodes.ResolveUsAsync(normalized, cancellationToken);
            return location is null
                ? NotFound(new { message = "That U.S. ZIP code could not be found." })
                : Ok(location);
        }
        catch (HttpRequestException)
        {
            return Problem(
                title: "Postal-code lookup is temporarily unavailable.",
                statusCode: StatusCodes.Status503ServiceUnavailable);
        }
    }
}

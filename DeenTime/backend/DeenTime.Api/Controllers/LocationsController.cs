using DeenTime.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace DeenTime.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/v1/locations")]
public sealed class LocationsController(PostalCodeResolver postalCodes) : ControllerBase
{
    [HttpGet("postal-code/{postalCode}")]
    [AllowAnonymous]
    [EnableRateLimiting("locations")]
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

    [HttpGet("address-suggestions")]
    [AllowAnonymous]
    [EnableRateLimiting("locations")]
    public async Task<IActionResult> AddressSuggestions(
        [FromQuery] string input,
        [FromQuery] string sessionToken,
        [FromServices] GoogleAddressResolver addresses,
        CancellationToken cancellationToken)
    {
        if (!addresses.IsEnabled)
            return Problem(title: "Address autocomplete is not configured.", statusCode: StatusCodes.Status503ServiceUnavailable);
        if (string.IsNullOrWhiteSpace(input) || input.Trim().Length < 4 || input.Length > 240 ||
            string.IsNullOrWhiteSpace(sessionToken) || sessionToken.Length > 128)
            return BadRequest(new { message = "Enter at least four address characters." });

        try
        {
            return Ok(await addresses.SearchAsync(input, sessionToken, cancellationToken));
        }
        catch (HttpRequestException)
        {
            return Problem(title: "Address lookup is temporarily unavailable.", statusCode: StatusCodes.Status503ServiceUnavailable);
        }
    }

    [HttpGet("address-details/{placeId}")]
    [AllowAnonymous]
    [EnableRateLimiting("locations")]
    public async Task<IActionResult> AddressDetails(
        string placeId,
        [FromQuery] string sessionToken,
        [FromServices] GoogleAddressResolver addresses,
        CancellationToken cancellationToken)
    {
        if (!addresses.IsEnabled)
            return Problem(title: "Address verification is not configured.", statusCode: StatusCodes.Status503ServiceUnavailable);
        if (string.IsNullOrWhiteSpace(placeId) || placeId.Length > 512 ||
            string.IsNullOrWhiteSpace(sessionToken) || sessionToken.Length > 128)
            return BadRequest(new { message = "Choose a valid address suggestion." });

        try
        {
            var address = await addresses.ResolveAsync(placeId, sessionToken, cancellationToken);
            return address is null
                ? NotFound(new { message = "That address could not be verified as a complete U.S. street address." })
                : Ok(address);
        }
        catch (HttpRequestException)
        {
            return Problem(title: "Address verification is temporarily unavailable.", statusCode: StatusCodes.Status503ServiceUnavailable);
        }
    }
}

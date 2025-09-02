using Microsoft.AspNetCore.Mvc;

namespace DeenTime.Api.Controllers
{
	[ApiController]
	[Route("public")]
	public sealed class PublicController : ControllerBase
	{
		[HttpGet("widget/{slug}")]
		public IActionResult Widget(string slug)
		{
			var html = $"<html><body><h1>Widget for {slug}</h1></body></html>";
			return Content(html, "text/html");
		}

		[HttpGet("tv/{slug}")]
		public IActionResult Tv(string slug)
		{
			var html = $"<html><body><div id='tv'>TV view for {slug}</div></body></html>";
			return Content(html, "text/html");
		}
	}
}

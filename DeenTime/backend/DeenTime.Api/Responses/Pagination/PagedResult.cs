namespace DeenTime.Api.Responses.Pagination;

public sealed record PagedResult<T>(IReadOnlyList<T> Items, int Page, int PageSize, int Total);



export interface PagedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export function pagedResult<T>(items: T[], page: number, pageSize: number, total: number): PagedResult<T> {
  return { items, page, pageSize, total };
}

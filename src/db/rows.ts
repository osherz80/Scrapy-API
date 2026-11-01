/**
 * Database rows are renamed once, at the boundary, so nothing downstream sees
 * `snake_case` product fields. SQL keeps the real column names.
 */
export function toCamelCase(column: string): string {
  const parts = column.split('_').filter((part) => part.length > 0);
  const [first, ...rest] = parts;
  if (first === undefined) return column;
  return first + rest.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
}

export function camelizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(row)) {
    result[toCamelCase(column)] = value;
  }
  return result;
}

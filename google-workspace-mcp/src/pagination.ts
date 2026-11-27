/**
 * Pagination helpers
 *
 * Read tools return bounded pages with an explicit continuation cursor instead
 * of silently truncating. The footer always names the exact parameter to pass
 * next, so a model never has to guess how to fetch the remainder.
 */

export interface SliceWindow<T> {
  items: T[];
  /** Zero-based inclusive start of the returned window. */
  start: number;
  /** Zero-based exclusive end of the returned window. */
  end: number;
  total: number;
  /** Next start value, or undefined when the collection is exhausted. */
  next?: number;
}

export interface TextPage {
  text: string;
  start: number;
  end: number;
  total: number;
  nextCursor?: string;
}

/**
 * Parse a numeric cursor, rejecting garbage instead of treating it as zero.
 */
export function parseCursor(cursor: string | undefined, label = "cursor"): number {
  if (cursor === undefined) {
    return 0;
  }
  const value = Number(cursor);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid ${label}: "${cursor}". Use the value from the previous response.`);
  }
  return value;
}

/**
 * Slice a collection and report whether more items remain.
 */
export function windowSlice<T>(items: T[], start: number, size: number): SliceWindow<T> {
  const total = items.length;
  const safeStart = Math.max(0, Math.min(start, total));
  const end = Math.min(safeStart + Math.max(1, size), total);

  return {
    items: items.slice(safeStart, end),
    start: safeStart,
    end,
    total,
    next: end < total ? end : undefined,
  };
}

/**
 * Slice rendered text by character offset.
 */
export function paginateText(text: string, offset: number, maxChars: number): TextPage {
  const total = text.length;
  const start = Math.max(0, Math.min(offset, total));
  const end = Math.min(start + Math.max(1, maxChars), total);

  return {
    text: text.slice(start, end),
    start,
    end,
    total,
    nextCursor: end < total ? String(end) : undefined,
  };
}

/**
 * Build the continuation footer for a text page. Returns an empty string when
 * the caller is already looking at the whole payload.
 */
export function textPageSuffix(page: TextPage): string {
  if (page.nextCursor) {
    return `\n\n_Characters ${page.start}–${page.end} of ${page.total}. Continue with \`cursor: "${page.nextCursor}"\`._`;
  }
  if (page.start > 0) {
    return `\n\n_Characters ${page.start}–${page.end} of ${page.total}._`;
  }
  return "";
}

/**
 * Build the continuation footer for a windowed collection.
 *
 * `label` is the human name of the items ("slides", "rows"), `param` is the
 * argument the caller should send next. Start/end are rendered 1-based.
 */
export function windowSuffix(
  window: SliceWindow<unknown>,
  label: string,
  param: string
): string {
  if (window.start === window.end) {
    return `\n\n_No ${label} in that range; there are ${window.total} in total._`;
  }
  if (window.next !== undefined) {
    return `\n\n_Showing ${label} ${window.start + 1}–${window.end} of ${window.total}. Continue with \`${param}: ${window.next}\`._`;
  }
  if (window.start > 0) {
    return `\n\n_Showing ${label} ${window.start + 1}–${window.end} of ${window.total}._`;
  }
  return "";
}

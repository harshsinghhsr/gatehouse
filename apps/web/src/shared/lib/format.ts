export const formatMoney = (value: number): string =>
  `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Token counts get large fast; the exact digit is never the point. */
export const formatCompact = (value: number): string =>
  value >= 1_000_000
    ? `${(value / 1_000_000).toFixed(1)}M`
    : value >= 1_000
      ? `${(value / 1_000).toFixed(1)}K`
      : String(value);

export const formatCount = (value: number): string => value.toLocaleString('en-US');

export const formatDate = (iso: string): string => new Date(iso).toLocaleDateString();

export const formatDateTime = (iso: string): string => new Date(iso).toLocaleString();

/** Trailing window ending today, as the API's date-only strings. */
export function trailingDays(days: number): { from: string; to: string } {
  const isoDate = (date: Date) => date.toISOString().slice(0, 10);
  return {
    from: isoDate(new Date(Date.now() - (days - 1) * 86_400_000)),
    to: isoDate(new Date()),
  };
}

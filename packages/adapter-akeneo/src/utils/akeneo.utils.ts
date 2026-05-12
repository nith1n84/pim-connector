/**
 * Formats a Date object into the Akeneo API compatible string format (YYYY-MM-DD HH:mm:ss).
 *
 * @param date - The date object to format
 * @returns A string representation of the date for Akeneo filters
 */
export function formatAkeneoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    date.getUTCFullYear() +
    "-" +
    pad(date.getUTCMonth() + 1) +
    "-" +
    pad(date.getUTCDate()) +
    " " +
    pad(date.getUTCHours()) +
    ":" +
    pad(date.getUTCMinutes()) +
    ":" +
    pad(date.getUTCSeconds())
  );
}

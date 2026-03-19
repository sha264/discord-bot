function formatToPartsMap(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });

  return Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  ) as Record<string, string>;
}

export function getJstDateKey(date = new Date()): string {
  const parts = formatToPartsMap(date, "Asia/Tokyo");
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function formatIsoForDisplay(iso: string | null): string {
  if (!iso) {
    return "-";
  }

  const parts = formatToPartsMap(new Date(iso), "Asia/Tokyo");
  return `${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}

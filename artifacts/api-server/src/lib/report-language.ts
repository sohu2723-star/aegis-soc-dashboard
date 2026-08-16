const MYANMAR_TEXT = /[\u1000-\u109f\uaa60-\uaa7f]/u;

export const REPORT_SECTION_HEADINGS = [
  "## Incident Summary",
  "## Key Threats",
  "## Defense Actions",
  "## Recommendations",
] as const;

export function containsMyanmarText(value: string | null | undefined): boolean {
  return MYANMAR_TEXT.test(value ?? "");
}

/** Keep generated reports English and structurally complete. */
export function ensureCompleteEnglishReport(
  generated: string | null | undefined,
  fallback: string,
): string {
  const text = (generated ?? "").trim();
  const complete =
    text.length >= 240 &&
    !containsMyanmarText(text) &&
    REPORT_SECTION_HEADINGS.every((heading) => text.includes(heading));
  return complete ? text : fallback;
}

export function englishArchivedTitle(
  title: string,
  generatedAt: Date,
  type: string,
): string {
  if (!containsMyanmarText(title)) return title;
  const label = generatedAt.toISOString().slice(0, 16).replace("T", " ") + " UTC";
  return `AEGIS ${type.charAt(0).toUpperCase() + type.slice(1)} Security Report — ${label}`;
}

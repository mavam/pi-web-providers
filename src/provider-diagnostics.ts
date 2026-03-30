function normalizeDiagnosticDetail(detail: string): string {
  return detail.trim().replace(/[.\s]+$/u, "");
}

function startsWithProviderLabel(
  providerLabel: string,
  detail: string,
): boolean {
  return detail.toLowerCase().startsWith(providerLabel.toLowerCase());
}

function readsLikeProviderClause(detail: string): boolean {
  return /^(is|has|was|returned|did|does|could|cannot|must|should|search\b|contents\b|answer\b|research\b|output\b|response\b|result\b|query\b|no\b|missing\b|deep research\b)/iu.test(
    detail,
  );
}

export function formatProviderDiagnostic(
  providerLabel: string,
  detail: string,
): string {
  const normalized = normalizeDiagnosticDetail(detail);
  if (!normalized) {
    return `${providerLabel} failed.`;
  }
  if (startsWithProviderLabel(providerLabel, normalized)) {
    return `${normalized}.`;
  }
  if (readsLikeProviderClause(normalized)) {
    return `${providerLabel} ${normalized}.`;
  }
  return `${providerLabel}: ${normalized}.`;
}

export function formatResearchTerminalDiagnostic(
  providerLabel: string,
  status: "failed" | "cancelled",
  detail?: string,
): string {
  const normalized = detail ? normalizeDiagnosticDetail(detail) : "";
  if (!normalized) {
    return status === "cancelled"
      ? `${providerLabel} research was canceled.`
      : `${providerLabel} research failed.`;
  }
  if (startsWithProviderLabel(providerLabel, normalized)) {
    return `${normalized}.`;
  }
  if (/^research\b/iu.test(normalized)) {
    return `${providerLabel} ${normalized}.`;
  }
  return status === "cancelled"
    ? `${providerLabel} research was canceled: ${normalized}.`
    : `${providerLabel} research failed: ${normalized}.`;
}

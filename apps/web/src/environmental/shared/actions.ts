export const PRODUCTION_PHASE_REASON =
  "Available in production implementation phase.";

export function navigateTo(hash: string) {
  window.location.hash = hash;
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function openPrintPreview() {
  window.print();
}

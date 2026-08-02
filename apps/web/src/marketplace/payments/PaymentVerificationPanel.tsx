import { useCallback, useEffect, useState } from "react";

const API_BASE_URL = "http://localhost:8080";

export function PaymentVerificationPanel({ token }: { token: string }) {
  const [claims, setClaims] = useState<any[]>([]);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    const response = await fetch(`${API_BASE_URL}/officer/marketplace/payment-claims`, { headers: { Authorization: `Bearer ${token}` } });
    if (response.status === 403) return setClaims([]);
    if (response.ok) setClaims((await response.json()).claims);
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  const decide = async (claimId: string, decision: "confirm" | "reject") => {
    const reason = decision === "reject" ? window.prompt("Rejection reason (required)") : undefined;
    if (decision === "reject" && !reason?.trim()) return setMessage("A rejection reason is required.");
    const response = await fetch(`${API_BASE_URL}/officer/marketplace/payment-claims/${claimId}/decision`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ decision, reason })
    });
    const result = await response.json(); setMessage(response.ok ? result.label : result.error); if (response.ok) await load();
  };

  if (!claims.length) return null;
  return <section style={{ background: "#1e293b", border: "1px solid #475569", borderRadius: "12px", padding: "20px", marginBottom: "24px" }}>
    <h2 style={{ marginTop: 0 }}>Pending Payment Claims</h2>
    {message && <p role="status">{message}</p>}
    {claims.map(claim => <article key={claim.id} style={{ borderTop: "1px solid #475569", padding: "14px 0" }}>
      <strong>{claim.invoiceNumber} — Awaiting Verification</strong>
      <p>Expected: {new Intl.NumberFormat("en-NG", { style: "currency", currency: claim.currency }).format(Number(claim.expectedAmountMicrounits) / 1_000_000)} · Reference: {claim.transactionReference}</p>
      <p>Receipt: {claim.receiptStorageKey.split("/").pop()} ({claim.receiptMimeType}, {claim.receiptSizeBytes} bytes)</p>
      <div style={{ display: "flex", gap: "8px" }}><button onClick={() => void decide(claim.id, "confirm")}>Confirm Payment</button><button onClick={() => void decide(claim.id, "reject")}>Reject</button></div>
    </article>)}
  </section>;
}

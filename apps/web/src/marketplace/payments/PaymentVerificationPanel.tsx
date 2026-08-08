import { useCallback, useEffect, useState } from "react";

const API_BASE_URL = "http://localhost:8080";

export function PaymentVerificationPanel({ token }: { token: string }) {
  const [claims, setClaims] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    const response = await fetch(`${API_BASE_URL}/officer/marketplace/payment-claims`, { headers: { Authorization: `Bearer ${token}` } });
    if (response.status === 403) return setClaims([]);
    if (response.ok) setClaims((await response.json()).claims);
    const paymentResponse = await fetch(`${API_BASE_URL}/officer/marketplace/payments`, { headers: { Authorization: `Bearer ${token}` } });
    if (paymentResponse.ok) setPayments((await paymentResponse.json()).payments);
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

  return <section style={{ background: "#1e293b", border: "1px solid #475569", borderRadius: "12px", padding: "20px", marginBottom: "24px" }}>
    <h2 style={{ marginTop: 0 }}>Finance and Payment Reconciliation</h2>
    {message && <p role="status">{message}</p>}
    {!claims.length && <p>No bank-transfer claims are awaiting verification.</p>}
    {claims.map(claim => <article key={claim.id} style={{ borderTop: "1px solid #475569", padding: "14px 0" }}>
      <strong>{claim.invoiceNumber} — Awaiting Verification</strong>
      <p>Expected: {new Intl.NumberFormat("en-NG", { style: "currency", currency: claim.currency }).format(Number(claim.expectedAmountMicrounits) / 1_000_000)} · Reference: {claim.transactionReference}</p>
      <p>Receipt: {claim.receiptStorageKey.split("/").pop()} ({claim.receiptMimeType}, {claim.receiptSizeBytes} bytes)</p>
      <div style={{ display: "flex", gap: "8px" }}><button onClick={() => void decide(claim.id, "confirm")}>Confirm Payment</button><button onClick={() => void decide(claim.id, "reject")}>Reject</button></div>
    </article>)}
    <h3>Recent registration payments</h3>
    <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr><th>Invoice</th><th>Business</th><th>Provider</th><th>Reference</th><th>Amount</th><th>Status</th><th>Paid</th></tr></thead><tbody>
      {payments.map(payment => <tr key={payment.id}><td>{payment.invoiceNumber}</td><td>{payment.businessName}</td><td>{payment.provider}</td><td>{payment.reference}</td><td>{new Intl.NumberFormat("en-NG", { style: "currency", currency: payment.currency }).format(Number(payment.amountMicrounits) / 1_000_000)}</td><td>{payment.status}</td><td>{payment.paidAt ? new Date(payment.paidAt).toLocaleString() : "—"}</td></tr>)}
    </tbody></table></div>
  </section>;
}

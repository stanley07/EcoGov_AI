import React, { useState } from "react";
import { INVITATION_ACCEPTANCE_HASH_ROUTE } from "@govos/core/invitation-routes";

const API_BASE_URL = "http://localhost:8080";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

type BrowserLocation = Pick<Location, "hash" | "pathname" | "search">;
type BrowserHistory = Pick<History, "replaceState">;

export function consumeInvitationToken(
  location: BrowserLocation,
  history: BrowserHistory,
): string | null {
  const [route = "", query = ""] = location.hash.split("?", 2);
  if (`#${route.replace(/^#/, "")}` !== INVITATION_ACCEPTANCE_HASH_ROUTE) return null;
  const parameters = new URLSearchParams(query);
  const tokens = parameters.getAll("token");
  if (tokens.length !== 1 || !TOKEN_PATTERN.test(tokens[0] || "")) return null;
  history.replaceState(
    null,
    "",
    `${location.pathname}${location.search}${INVITATION_ACCEPTANCE_HASH_ROUTE}`,
  );
  return tokens[0] || null;
}

export function createPageLoadInvitationTokenCapture() {
  let capturedToken: string | null | undefined;
  return (location: BrowserLocation, history: BrowserHistory): string | null => {
    if (capturedToken !== undefined) return capturedToken;
    capturedToken = consumeInvitationToken(location, history);
    return capturedToken;
  };
}

const capturePageLoadInvitationToken = createPageLoadInvitationTokenCapture();

export function InvitationAcceptancePage() {
  const [token, setToken] = useState<string | null>(() =>
    capturePageLoadInvitationToken(window.location, window.history),
  );
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [status, setStatus] = useState<"ready" | "submitting" | "accepted" | "error">(
    token ? "ready" : "error",
  );
  const [message, setMessage] = useState(
    token ? "" : "This invitation link is missing or invalid.",
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!token) return;
    if (password.length < 12 || password !== confirmation) {
      setStatus("error");
      setMessage("Enter matching passwords of at least 12 characters.");
      return;
    }
    setStatus("submitting");
    setMessage("");
    try {
      const response = await fetch(`${API_BASE_URL}/auth/invitations/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      setPassword("");
      setConfirmation("");
      if (!response.ok) {
        setStatus("error");
        setMessage("This invitation could not be accepted. It may be invalid or expired.");
        return;
      }
      setToken(null);
      setStatus("accepted");
      setMessage("Invitation accepted. You may now sign in to your government workspace.");
    } catch {
      setPassword("");
      setConfirmation("");
      setStatus("error");
      setMessage("Invitation acceptance is temporarily unavailable. Please try again.");
    }
  };

  return (
    <main
      id="main-content"
      style={{ minHeight: "100vh", background: "#07111f", color: "#f8fafc", display: "grid", placeItems: "center", padding: "24px" }}
    >
      <section
        aria-labelledby="invitation-heading"
        style={{ width: "min(100%, 480px)", background: "#0f1f33", border: "1px solid #31506f", borderRadius: "16px", padding: "clamp(24px, 6vw, 40px)", boxSizing: "border-box" }}
      >
        <p style={{ color: "#5eead4", fontWeight: 700, margin: "0 0 8px" }}>EcoGov AI</p>
        <h1 id="invitation-heading" style={{ margin: "0 0 12px", fontSize: "clamp(1.75rem, 7vw, 2.25rem)" }}>
          Accept your invitation
        </h1>
        <p style={{ color: "#cbd5e1", lineHeight: 1.6 }}>
          Create a private password to activate your tenant account. Acceptance does not sign you in automatically.
        </p>

        {status === "accepted" ? (
          <div role="status" style={{ padding: "16px", borderRadius: "8px", background: "#12372d", color: "#bbf7d0" }}>
            {message}
          </div>
        ) : token ? (
          <form onSubmit={submit} style={{ display: "grid", gap: "16px" }}>
            <label htmlFor="invitation-password">
              <span style={{ display: "block", marginBottom: "6px" }}>New password</span>
              <input
                id="invitation-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                style={{ width: "100%", minHeight: "44px", boxSizing: "border-box", borderRadius: "8px", border: "1px solid #64748b", padding: "10px 12px" }}
              />
            </label>
            <label htmlFor="invitation-password-confirmation">
              <span style={{ display: "block", marginBottom: "6px" }}>Confirm password</span>
              <input
                id="invitation-password-confirmation"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                style={{ width: "100%", minHeight: "44px", boxSizing: "border-box", borderRadius: "8px", border: "1px solid #64748b", padding: "10px 12px" }}
              />
            </label>
            {message && <p role="alert" style={{ color: "#fecaca", margin: 0 }}>{message}</p>}
            <button
              type="submit"
              disabled={status === "submitting"}
              style={{ minHeight: "44px", border: 0, borderRadius: "8px", background: "#14b8a6", color: "#042f2e", fontWeight: 800, cursor: "pointer" }}
            >
              {status === "submitting" ? "Accepting invitation…" : "Activate account"}
            </button>
          </form>
        ) : (
          <div role="alert" style={{ padding: "16px", borderRadius: "8px", background: "#3f1d28", color: "#fecdd3" }}>
            {message}
          </div>
        )}
      </section>
    </main>
  );
}

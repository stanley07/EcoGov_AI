import React, { useEffect, useState } from "react";
type Session = {
  id: string;
  createdAt: string;
  expiresAt: string;
  deviceLabel: string;
  currentSession?: boolean;
};
const control: React.CSSProperties = {
  minHeight: 44,
  padding: "10px 12px",
  borderRadius: 6,
  border: "1px solid #64748b",
};
export function AccountSecurityPage({
  apiBaseUrl,
  token,
}: {
  apiBaseUrl: string;
  token: string;
}) {
  const [sessions, setSessions] = useState<Session[]>([]),
    [message, setMessage] = useState(""),
    [codes, setCodes] = useState<string[]>([]),
    [enrollment, setEnrollment] = useState<{
      secret: string;
      provisioningUri: string;
    } | null>(null);
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const load = () =>
    fetch(`${apiBaseUrl}/auth/sessions`, { headers })
      .then((r) => r.json())
      .then(setSessions);
  useEffect(() => {
    void load();
    return () => {
      setCodes([]);
      setEnrollment(null);
    };
  }, []);
  async function post(path: string, body: object) {
    const r = await fetch(`${apiBaseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Security action failed");
    return data;
  }
  return (
    <div style={{ display: "grid", gap: 24, maxWidth: 800 }}>
      <header>
        <h1>Account Security</h1>
        <p>
          Manage your password, multi-factor authentication, recovery codes, and
          active sessions.
        </p>
      </header>
      <section>
        <h2>Change password</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            try {
              await post("/auth/password/change", {
                currentPassword: f.get("currentPassword"),
                newPassword: f.get("newPassword"),
              });
              setMessage("Password changed. Other sessions were revoked.");
              e.currentTarget.reset();
            } catch (x) {
              setMessage((x as Error).message);
            }
          }}
          style={{ display: "grid", gap: 10 }}
        >
          <input
            name="currentPassword"
            type="password"
            required
            autoComplete="current-password"
            aria-label="Current password"
            style={control}
          />
          <input
            name="newPassword"
            type="password"
            minLength={12}
            required
            autoComplete="new-password"
            aria-label="New password"
            style={control}
          />
          <button style={control}>Change password</button>
        </form>
      </section>
      <section>
        <h2>Multi-factor authentication</h2>
        {!enrollment && (
          <button
            style={control}
            onClick={async () => {
              try {
                setEnrollment(await post("/auth/mfa/enrollment/start", {}));
              } catch (x) {
                setMessage((x as Error).message);
              }
            }}
          >
            Enroll MFA
          </button>
        )}
        {enrollment && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                const data = await post("/auth/mfa/enrollment/verify", {
                  code: f.get("code"),
                });
                setCodes(data.recoveryCodes);
                setEnrollment(null);
              } catch (x) {
                setMessage((x as Error).message);
              }
            }}
          >
            <p>
              Scan the provisioning URI with your authenticator. The secret is
              shown only during enrollment.
            </p>
            <code style={{ overflowWrap: "anywhere" }}>
              {enrollment.provisioningUri}
            </code>
            <input
              name="code"
              aria-label="Authenticator code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              required
              style={control}
            />
            <button style={control}>Verify MFA</button>
          </form>
        )}
        {codes.length > 0 && (
          <div
            role="region"
            aria-label="Recovery codes"
            style={{ border: "2px solid #b45309", padding: 16 }}
          >
            <h3>Save these recovery codes now</h3>
            <ul>
              {codes.map((c) => (
                <li key={c}>
                  <code>{c}</code>
                </li>
              ))}
            </ul>
            <button style={control} onClick={() => setCodes([])}>
              I have saved these codes
            </button>
          </div>
        )}
      </section>
      <section>
        <h2>Active sessions</h2>
        <button
          style={control}
          onClick={async () => {
            await post("/auth/sessions/revoke-others", {});
            void load();
          }}
        >
          Revoke other sessions
        </button>
        <ul>
          {sessions.map((s) => (
            <li key={s.id}>
              {s.deviceLabel} — {new Date(s.createdAt).toLocaleString()}{" "}
              {s.currentSession && "(current)"}{" "}
              <button
                style={control}
                onClick={async () => {
                  await fetch(`${apiBaseUrl}/auth/sessions/${s.id}`, {
                    method: "DELETE",
                    headers,
                  });
                  void load();
                }}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      </section>
      {message && <p role="status">{message}</p>}
    </div>
  );
}

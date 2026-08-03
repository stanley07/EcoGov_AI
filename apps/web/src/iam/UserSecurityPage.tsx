import { useEffect, useState } from "react";
export function UserSecurityPage({
  apiBaseUrl,
  token,
  userId,
}: {
  apiBaseUrl: string;
  token: string;
  userId: string;
}) {
  const [data, setData] = useState<any>(),
    [sessions, setSessions] = useState<any[]>([]),
    [audit, setAudit] = useState<any[]>([]),
    [message, setMessage] = useState("");
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const load = () =>
    Promise.all([
      fetch(`${apiBaseUrl}/users/${userId}/security`, { headers }).then((r) =>
        r.json(),
      ),
      fetch(`${apiBaseUrl}/users/${userId}/security/sessions`, {
        headers,
      }).then((r) => r.json()),
      fetch(`${apiBaseUrl}/users/${userId}/security/audit`, { headers }).then(
        (r) => r.json(),
      ),
    ]).then(([d, s, a]) => {
      setData(d);
      setSessions(s);
      setAudit(a);
    });
  useEffect(() => {
    void load();
  }, [userId]);
  async function action(path: string, label: string) {
    const reason = window.prompt(`${label} reason (required)`);
    if (!reason?.trim()) return;
    const r = await fetch(`${apiBaseUrl}/users/${userId}/security/${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ reason }),
    });
    const result = await r.json();
    setMessage(r.ok ? `${label} completed` : result.error);
    if (r.ok) void load();
  }
  if (!data) return <p>Loading security details…</p>;
  return (
    <div style={{ display: "grid", gap: 22 }}>
      <header>
        <h1>User Security</h1>
        <a href="#/administration/users">Back to Users &amp; Access</a>
      </header>
      <section>
        <h2>Account security status</h2>
        <dl>
          <dt>Account</dt>
          <dd>{data.status}</dd>
          <dt>Membership</dt>
          <dd>{data.membershipStatus}</dd>
          <dt>Password reset required</dt>
          <dd>{String(data.passwordResetRequired)}</dd>
          <dt>MFA verified</dt>
          <dd>{String(data.mfaVerified)}</dd>
          <dt>Recovery codes available</dt>
          <dd>{data.recoveryCodeCount}</dd>
        </dl>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={() =>
              action("force-password-reset", "Require password reset")
            }
          >
            Require Password Reset
          </button>
          <button onClick={() => action("mfa-reset", "Reset MFA")}>
            Reset MFA
          </button>
          <button
            onClick={() => action("sessions/revoke-all", "Revoke all sessions")}
          >
            Revoke All Sessions
          </button>
        </div>
      </section>
      <section>
        <h2>Active sessions</h2>
        <ul>
          {sessions.map((s) => (
            <li key={s.id}>
              {s.deviceLabel} — {new Date(s.createdAt).toLocaleString()}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2>Security audit history</h2>
        <ul>
          {audit.map((x, i) => (
            <li key={`${x.timestamp}-${i}`}>
              {x.eventType} — {new Date(x.timestamp).toLocaleString()}{" "}
              {x.reason || ""}
            </li>
          ))}
        </ul>
      </section>
      {message && <p role="status">{message}</p>}
    </div>
  );
}

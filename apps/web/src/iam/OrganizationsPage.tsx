import { useCallback, useEffect, useState } from "react";
type Organization = {
  id: string;
  name: string;
  status: string;
  version: number;
  activeUserCount: number;
};
const control = {
  minHeight: 44,
  padding: "10px 12px",
  border: "1px solid #64748b",
  borderRadius: 6,
};
export function OrganizationsPage({
  apiBaseUrl,
  token,
  canCreate,
}: {
  apiBaseUrl: string;
  token: string;
  canCreate: boolean;
}) {
  const [rows, setRows] = useState<Organization[]>([]),
    [message, setMessage] = useState("");
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const load = useCallback(
    () =>
      fetch(`${apiBaseUrl}/organizations`, { headers })
        .then(async (r) => {
          const d = await r.json();
          if (!r.ok) throw new Error(d.error);
          setRows(d);
        })
        .catch((e) => setMessage(e.message)),
    [apiBaseUrl, token],
  );
  useEffect(() => {
    void load();
  }, [load]);
  async function create() {
    const name = window.prompt("Organization name");
    if (!name?.trim()) return;
    const r = await fetch(`${apiBaseUrl}/organizations`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name }),
    });
    const d = await r.json();
    setMessage(r.ok ? "Organization created" : d.error);
    if (r.ok) void load();
  }
  return (
    <div>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1>Organizations</h1>
          <p>Manage tenant organizations and delegated administration.</p>
        </div>
        {canCreate && (
          <button style={control} onClick={() => void create()}>
            Create organization
          </button>
        )}
      </header>
      {message && <p role="status">{message}</p>}
      <div style={{ overflowX: "auto" }}>
        <table>
          <caption className="sr-only">Tenant organizations</caption>
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Active users</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id}>
                <td>{o.name}</td>
                <td>{o.status}</td>
                <td>{o.activeUserCount}</td>
                <td>
                  <a
                    href={`#/administration/organizations/${o.id}`}
                    style={control}
                  >
                    View organization
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
const control = {
  minHeight: 44,
  padding: "10px 12px",
  border: "1px solid #64748b",
  borderRadius: 6,
};
export function OrganizationDetailPage({
  apiBaseUrl,
  token,
  organizationId,
  isTenantAdmin,
}: {
  apiBaseUrl: string;
  token: string;
  organizationId: string;
  isTenantAdmin: boolean;
}) {
  const [organization, setOrganization] = useState<any>(),
    [users, setUsers] = useState<any[]>([]),
    [invitations, setInvitations] = useState<any[]>([]),
    [tab, setTab] = useState<"users" | "invitations" | "settings">("users"),
    [message, setMessage] = useState("");
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const load = useCallback(
    () =>
      Promise.all([
        fetch(`${apiBaseUrl}/organizations/${organizationId}`, {
          headers,
        }).then((r) => r.json()),
        fetch(`${apiBaseUrl}/organizations/${organizationId}/users`, {
          headers,
        }).then((r) => r.json()),
        fetch(`${apiBaseUrl}/organizations/${organizationId}/invitations`, {
          headers,
        }).then((r) => r.json()),
      ]).then(([o, u, i]) => {
        setOrganization(o);
        setUsers(u);
        setInvitations(i);
      }),
    [apiBaseUrl, token, organizationId],
  );
  useEffect(() => {
    void load();
  }, [load]);
  async function invite() {
    const email = window.prompt("Email"),
      firstName = window.prompt("First name"),
      lastName = window.prompt("Last name"),
      roleId = window.prompt("Approved organization role ID");
    if (!email || !firstName || !lastName || !roleId) return;
    const r = await fetch(
      `${apiBaseUrl}/organizations/${organizationId}/invitations`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ email, firstName, lastName, roleId }),
      },
    );
    const d = await r.json();
    setMessage(r.ok ? "Invitation queued" : d.error);
    if (r.ok) void load();
  }
  async function update(status?: string) {
    const reason = window.prompt("Reason (required)"),
      name = status
        ? undefined
        : window.prompt("Organization name", organization.name);
    if (!reason || (!status && !name)) return;
    const r = await fetch(`${apiBaseUrl}/organizations/${organizationId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        name,
        status,
        expectedVersion: organization.version,
        reason,
      }),
    });
    const d = await r.json();
    setMessage(r.ok ? "Organization updated" : d.error);
    if (r.ok) void load();
  }
  async function manageUser(
    user: any,
    action: "admin" | "role" | "status" | "transfer" | "remove",
  ) {
    const reason = window.prompt("Reason (required)");
    if (!reason) return;
    let path = `${apiBaseUrl}/organizations/${organizationId}/users/${user.id}`;
    let method = "PATCH";
    let body: Record<string, unknown> = {
      expectedVersion: user.membershipVersion,
      reason,
    };
    if (action === "admin") {
      path = `${apiBaseUrl}/organizations/${organizationId}/administrators`;
      method = "POST";
      body = {
        userId: user.id,
        expectedVersion: user.membershipVersion,
        reason,
      };
    } else if (action === "role") {
      const roleId = window.prompt("Approved organization role ID");
      if (!roleId) return;
      body.roleId = roleId;
    } else if (action === "status") {
      body.accountStatus =
        user.accountStatus === "suspended" ? "active" : "suspended";
    } else if (action === "transfer") {
      const targetOrganizationId = window.prompt("Target organization ID");
      if (!targetOrganizationId) return;
      path += "/transfer";
      method = "POST";
      body.targetOrganizationId = targetOrganizationId;
    } else {
      method = "DELETE";
    }
    const response = await fetch(path, {
      method,
      headers,
      body: JSON.stringify(body),
    });
    const result = await response.json();
    setMessage(response.ok ? "Organization user updated" : result.error);
    if (response.ok) void load();
  }
  if (!organization) return <p>Loading organization…</p>;
  return (
    <div>
      <header>
        <a href="#/administration/organizations">Organizations</a>
        <h1>{organization.name}</h1>
        <p>
          Status: {organization.status} · Version {organization.version}
        </p>
      </header>
      <div
        role="tablist"
        aria-label="Organization administration"
        style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
      >
        {(["users", "invitations", "settings"] as const).map((x) => (
          <button
            key={x}
            role="tab"
            aria-selected={tab === x}
            style={control}
            onClick={() => setTab(x)}
          >
            {x[0]!.toUpperCase() + x.slice(1)}
          </button>
        ))}
      </div>
      {tab === "users" && (
        <section>
          <h2>Organization users</h2>
          <ul>
            {users.map((u) => (
              <li key={u.id} style={{ marginBottom: 12 }}>
                {u.firstName} {u.lastName} — {u.roleName} — {u.accountStatus}{" "}
                <a href={`#/administration/users/${u.id}/security`}>Security</a>{" "}
                <button
                  style={control}
                  onClick={() => void manageUser(u, "status")}
                >
                  {u.accountStatus === "suspended" ? "Reactivate" : "Suspend"}
                </button>{" "}
                <button
                  style={control}
                  onClick={() => void manageUser(u, "role")}
                >
                  Change role
                </button>{" "}
                {isTenantAdmin && (
                  <>
                    <button
                      style={control}
                      onClick={() => void manageUser(u, "admin")}
                    >
                      Assign organization administrator
                    </button>{" "}
                    <button
                      style={control}
                      onClick={() => void manageUser(u, "transfer")}
                    >
                      Transfer
                    </button>{" "}
                  </>
                )}
                <button
                  style={control}
                  onClick={() => void manageUser(u, "remove")}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {tab === "invitations" && (
        <section>
          <h2>Organization invitations</h2>
          <button style={control} onClick={() => void invite()}>
            Invite user
          </button>
          <ul>
            {invitations.map((i) => (
              <li key={i.id}>
                {i.email} — {i.roleName} — {i.status}
              </li>
            ))}
          </ul>
        </section>
      )}
      {tab === "settings" && (
        <section>
          <h2>Organization settings</h2>
          <button style={control} onClick={() => void update()}>
            Rename
          </button>
          <button
            style={control}
            onClick={() =>
              void update(
                organization.status === "suspended" ? "active" : "suspended",
              )
            }
          >
            {organization.status === "suspended" ? "Reactivate" : "Suspend"}
          </button>
          {isTenantAdmin && (
            <button style={control} onClick={() => void update("archived")}>
              Archive
            </button>
          )}
        </section>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}

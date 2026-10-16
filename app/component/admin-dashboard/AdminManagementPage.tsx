"use client";

import { useEffect, useState } from "react";
import AdminDashboardShell from "./AdminDashboardShell";
import { supabase } from "@/lib/supabase/client";

type AdminStatus = "pending" | "approved" | "inactive" | "rejected";
type AdminAccount = {
  id: string;
  full_name: string;
  username: string;
  email: string;
  phone: string;
  approval_status: AdminStatus;
  created_at: string;
};

const panelStyle = {
  border: "1px solid #e3e9e4",
  borderRadius: 8,
  background: "#fff",
} as const;
const buttonStyle = {
  padding: "6px 9px",
  border: "1px solid #dce4de",
  borderRadius: 6,
  background: "#fff",
  color: "#267451",
  fontSize: 10,
  fontWeight: 650,
  cursor: "pointer",
} as const;

function isAdminStatus(value: unknown): value is AdminStatus {
  return value === "pending" || value === "approved" || value === "inactive" || value === "rejected";
}

function isAdminAccount(value: unknown): value is AdminAccount {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const account = value as Record<string, unknown>;
  return typeof account.id === "string"
    && typeof account.full_name === "string"
    && typeof account.username === "string"
    && typeof account.email === "string"
    && typeof account.phone === "string"
    && isAdminStatus(account.approval_status)
    && typeof account.created_at === "string"
    && Number.isFinite(Date.parse(account.created_at));
}

async function fetchAdminAccounts() {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!user) throw new Error("Sign in to manage admin accounts.");

  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .select("role, approval_status")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) throw profileError;
  const hasAdminAccess = (profile?.role === "admin" || profile?.role === "superadmin")
    && profile.approval_status === "approved";
  const isSuperadmin = profile?.role === "superadmin" && profile.approval_status === "approved";
  if (!hasAdminAccess) return { hasAdminAccess, isSuperadmin, admins: [] as AdminAccount[] };

  const { data, error: loadError } = await supabase.rpc("admin_get_admin_management");
  if (loadError) throw loadError;
  if (!Array.isArray(data) || !data.every(isAdminAccount)) {
    throw new Error("The admin account data returned by Supabase is invalid.");
  }
  return { hasAdminAccess, isSuperadmin, admins: data };
}

export default function AdminManagementPage() {
  const [admins, setAdmins] = useState<AdminAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasAdminAccess, setHasAdminAccess] = useState(false);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [updatingId, setUpdatingId] = useState("");

  useEffect(() => {
    let active = true;
    void fetchAdminAccounts()
      .then((result) => {
        if (!active) return;
        setHasAdminAccess(result.hasAdminAccess);
        setIsSuperadmin(result.isSuperadmin);
        setAdmins(result.admins);
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Could not load admin accounts.");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function updateAdmin(admin: AdminAccount, action: "approve" | "reject" | "activate" | "deactivate") {
    setUpdatingId(admin.id);
    setError("");
    setMessage("");
    try {
      const result = action === "approve" || action === "reject"
        ? await supabase.rpc("admin_review_admin_signup", {
          target_admin_user_id: admin.id,
          decision: action === "approve" ? "approved" : "rejected",
        })
        : await supabase.rpc("admin_set_admin_active", {
          target_admin_user_id: admin.id,
          should_be_active: action === "activate",
        });
      if (result.error) throw result.error;
      setMessage(action === "approve"
        ? `${admin.full_name} was approved.`
        : action === "reject"
          ? `${admin.full_name}'s request was rejected.`
          : action === "deactivate"
            ? `${admin.full_name} was set inactive.`
            : `${admin.full_name} was activated.`);
      const refreshed = await fetchAdminAccounts();
      setHasAdminAccess(refreshed.hasAdminAccess);
      setIsSuperadmin(refreshed.isSuperadmin);
      setAdmins(refreshed.admins);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Could not update the admin account.");
    } finally {
      setUpdatingId("");
    }
  }

  const activeCount = admins.filter((admin) => admin.approval_status === "approved").length;
  const requestCount = admins.filter((admin) => admin.approval_status === "pending").length;
  const requests = admins.filter((admin) => admin.approval_status === "pending");

  return (
    <AdminDashboardShell>
      <main style={{ width: "100%", maxWidth: 1440, margin: "0 auto", padding: "28px clamp(16px, 3vw, 38px) 44px" }}>
        <div style={{ marginBottom: 22 }}>
          <div style={{ color: "#78867f", fontSize: 11, marginBottom: 6 }}>Admin workspace</div>
          <h1 style={{ margin: 0, color: "#1d2c25", fontSize: 26, lineHeight: 1.2, fontWeight: 750 }}>Admin Management</h1>
          <p style={{ margin: "7px 0 0", color: "#78867f", fontSize: 12 }}>Review admin requests and manage dashboard access.</p>
        </div>

        {error && <p role="alert" style={{ margin: "0 0 14px", padding: "10px 12px", border: "1px solid #f0c7c4", borderRadius: 7, background: "#fff4f3", color: "#9b3630", fontSize: 12 }}>{error}</p>}
        {message && <p role="status" style={{ margin: "0 0 14px", padding: "10px 12px", border: "1px solid #cce8d8", borderRadius: 7, background: "#f1faf5", color: "#267451", fontSize: 12 }}>{message}</p>}

        {!isLoading && !hasAdminAccess ? (
          <p role="alert" style={{ ...panelStyle, padding: 18, color: "#9b3630", fontSize: 12 }}>An active admin account is required to view admin management.</p>
        ) : (
          <>
            {!isSuperadmin && hasAdminAccess && (
              <p style={{ ...panelStyle, margin: "0 0 14px", padding: 12, color: "#68776f", fontSize: 11 }}>
                Admin accounts are shown in read-only mode. A superadmin can approve requests or change admin status.
              </p>
            )}
            <section aria-label="Admin metrics" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginBottom: 18 }}>
              {[
                { label: "Total Admin", value: admins.length, color: "#16865f", background: "#e8f7ef" },
                { label: "Active Admin", value: activeCount, color: "#2476a5", background: "#eaf4fa" },
                { label: "Admin Request", value: requestCount, color: "#9a6a11", background: "#fbf3df" },
              ].map((metric) => (
                <article key={metric.label} style={{ ...panelStyle, minHeight: 100, display: "grid", alignContent: "space-between", gap: 12, padding: "14px 15px" }}>
                  <span style={{ color: "#68776f", fontSize: 11 }}>{metric.label}</span>
                  <strong style={{ width: "fit-content", padding: "4px 9px", borderRadius: 6, background: metric.background, color: metric.color, fontSize: 20 }}>{isLoading ? "—" : metric.value}</strong>
                </article>
              ))}
            </section>

            <section aria-label="Admin approval requests" style={{ ...panelStyle, marginBottom: 18, overflow: "hidden" }}>
              <div style={{ padding: "16px 18px", borderBottom: "1px solid #edf0ed" }}>
                <h2 style={{ margin: 0, color: "#20312a", fontSize: 15, fontWeight: 700 }}>Admin approval requests</h2>
                <p style={{ margin: "5px 0 0", color: "#7a8981", fontSize: 11 }}>New registrations remain pending until a superadmin approves them.</p>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", minWidth: 720, borderCollapse: "collapse", textAlign: "left" }}>
                  <thead><tr>{["Name", "Username", "Email", "Phone", "Requested", "Actions"].map((column) => <th key={column} style={{ padding: "10px 12px", background: "#f8faf8", borderBottom: "1px solid #edf0ed", color: "#78857e", fontSize: 10, fontWeight: 650, whiteSpace: "nowrap" }}>{column}</th>)}</tr></thead>
                  <tbody>
                    {isLoading ? <tr><td colSpan={6} style={{ padding: 24, color: "#78857e", fontSize: 12, textAlign: "center" }}>Loading admin requests...</td></tr> : requests.map((admin) => (
                      <tr key={admin.id}>
                        <td style={{ padding: 12, borderBottom: "1px solid #f0f2f0", color: "#26372f", fontSize: 11, fontWeight: 600 }}>{admin.full_name}</td>
                        <td style={{ padding: 12, borderBottom: "1px solid #f0f2f0", color: "#64736b", fontSize: 11 }}>{admin.username}</td>
                        <td style={{ padding: 12, borderBottom: "1px solid #f0f2f0", color: "#64736b", fontSize: 11 }}>{admin.email}</td>
                        <td style={{ padding: 12, borderBottom: "1px solid #f0f2f0", color: "#64736b", fontSize: 11 }}>{admin.phone || "—"}</td>
                        <td style={{ padding: 12, borderBottom: "1px solid #f0f2f0", color: "#64736b", fontSize: 11, whiteSpace: "nowrap" }}>{new Date(admin.created_at).toLocaleDateString("en-BD")}</td>
                        <td style={{ padding: 12, borderBottom: "1px solid #f0f2f0", whiteSpace: "nowrap" }}>
                          {isSuperadmin ? <>
                          <button type="button" disabled={updatingId === admin.id} onClick={() => void updateAdmin(admin, "approve")} style={{ ...buttonStyle, marginRight: 6, border: 0, background: "#18845d", color: "#fff", opacity: updatingId === admin.id ? 0.6 : 1 }}>Approve</button>
                          <button type="button" disabled={updatingId === admin.id} onClick={() => void updateAdmin(admin, "reject")} style={{ ...buttonStyle, color: "#a33d35", opacity: updatingId === admin.id ? 0.6 : 1 }}>Reject</button>
                          </> : <span style={{ color: "#87928d", fontSize: 10 }}>Superadmin only</span>}
                        </td>
                      </tr>
                    ))}
                    {!isLoading && requests.length === 0 && <tr><td colSpan={6} style={{ padding: 24, color: "#87928d", fontSize: 12, textAlign: "center" }}>No admin requests are waiting for approval.</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>

            <section aria-label="All admin accounts" style={{ ...panelStyle, overflow: "hidden" }}>
              <div style={{ padding: "16px 18px", borderBottom: "1px solid #edf0ed" }}>
                <h2 style={{ margin: 0, color: "#20312a", fontSize: 15, fontWeight: 700 }}>Admin accounts</h2>
                <p style={{ margin: "5px 0 0", color: "#7a8981", fontSize: 11 }}>Manage active and inactive admin dashboard access.</p>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", minWidth: 800, borderCollapse: "collapse", textAlign: "left" }}>
                  <thead><tr>{["Name", "Username", "Email", "Phone", "Status", "Registered", "Actions"].map((column) => <th key={column} style={{ padding: "10px 12px", background: "#f8faf8", borderBottom: "1px solid #edf0ed", color: "#78857e", fontSize: 10, fontWeight: 650, whiteSpace: "nowrap" }}>{column}</th>)}</tr></thead>
                  <tbody>
                    {isLoading ? <tr><td colSpan={7} style={{ padding: 24, color: "#78857e", fontSize: 12, textAlign: "center" }}>Loading admin accounts...</td></tr> : admins.map((admin) => (
                      <tr key={admin.id}>
                        <td style={{ padding: 12, borderBottom: "1px solid #f0f2f0", color: "#26372f", fontSize: 11, fontWeight: 600 }}>{admin.full_name}</td>
                        <td style={{ padding: 12, borderBottom: "1px solid #f0f2f0", color: "#64736b", fontSize: 11 }}>{admin.username}</td>
                        <td style={{ padding: 12, borderBottom: "1px solid #f0f2f0", color: "#64736b", fontSize: 11 }}>{admin.email}</td>
                        <td style={{ padding: 12, borderBottom: "1px solid #f0f2f0", color: "#64736b", fontSize: 11 }}>{admin.phone || "—"}</td>
                        <td style={{ padding: 12, borderBottom: "1px solid #f0f2f0" }}><span style={{ padding: "4px 7px", borderRadius: 12, background: admin.approval_status === "approved" ? "#e8f7ef" : admin.approval_status === "inactive" ? "#f0f2f1" : admin.approval_status === "pending" ? "#fff3e6" : "#fceeee", color: admin.approval_status === "approved" ? "#267451" : admin.approval_status === "inactive" ? "#68776f" : admin.approval_status === "pending" ? "#9a6a11" : "#ae4545", fontSize: 9, fontWeight: 700 }}>{admin.approval_status}</span></td>
                        <td style={{ padding: 12, borderBottom: "1px solid #f0f2f0", color: "#64736b", fontSize: 11, whiteSpace: "nowrap" }}>{new Date(admin.created_at).toLocaleDateString("en-BD")}</td>
                        <td style={{ padding: 12, borderBottom: "1px solid #f0f2f0", whiteSpace: "nowrap" }}>
                          {isSuperadmin && admin.approval_status === "approved" && <button type="button" disabled={updatingId === admin.id} onClick={() => void updateAdmin(admin, "deactivate")} style={{ ...buttonStyle, color: "#a33d35", opacity: updatingId === admin.id ? 0.6 : 1 }}>Set inactive</button>}
                          {isSuperadmin && admin.approval_status === "inactive" && <button type="button" disabled={updatingId === admin.id} onClick={() => void updateAdmin(admin, "activate")} style={{ ...buttonStyle, color: "#267451", opacity: updatingId === admin.id ? 0.6 : 1 }}>Activate</button>}
                          {(!isSuperadmin || admin.approval_status === "pending" || admin.approval_status === "rejected") && <span style={{ color: "#87928d", fontSize: 10 }}>{isSuperadmin ? "—" : "Superadmin only"}</span>}
                        </td>
                      </tr>
                    ))}
                    {!isLoading && admins.length === 0 && <tr><td colSpan={7} style={{ padding: 24, color: "#87928d", fontSize: 12, textAlign: "center" }}>No admin accounts have registered yet.</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
    </AdminDashboardShell>
  );
}

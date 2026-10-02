"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import AdminDashboardShell from "./AdminDashboardShell";
import { supabase } from "@/lib/supabase/client";

type User = {
  id: string;
  username: string;
  full_name: string;
  email: string;
  phone: string;
  role: "pharmacy_user" | "admin" | "superadmin";
  pharmacy: {
    store_name: string;
    company_name: string;
    address: string;
    city: string;
    country: string;
  } | null;
};

const inputStyle = { width: "100%", minWidth: 180, padding: "8px 10px", border: "1px solid #dce4de", borderRadius: 6, background: "#fff", color: "#34453b", fontSize: 12 } as const;
const buttonStyle = { padding: "7px 10px", border: "1px solid #dce4de", borderRadius: 6, background: "#fff", color: "#267451", fontSize: 11, fontWeight: 650, cursor: "pointer" } as const;

export default function UserManagementPage() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [adminForm, setAdminForm] = useState({ email: "", fullName: "", username: "", phone: "", password: "" });
  const [message, setMessage] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;

    async function loadUsers() {
      setIsLoading(true);
      const { data: { user: authUser } } = await supabase.auth.getUser();

      if (!authUser) {
        router.replace("/login");
        return;
      }

      const { data: actor, error: actorError } = await supabase
        .from("user_profiles")
        .select("role")
        .eq("id", authUser.id)
        .maybeSingle();

      if (actorError || actor?.role !== "superadmin") {
        if (active) {
          setMessage(actorError?.message ?? "Only a superadmin can manage user accounts.");
          setIsLoading(false);
        }
        return;
      }

      const [profilesResult, pharmaciesResult] = await Promise.all([
        supabase.from("user_profiles").select("id, username, full_name, email, phone, role").order("created_at", { ascending: false }),
        supabase.from("pharmacies").select("owner_user_id, store_name, company_name, address, city, country"),
      ]);

      const loadError = profilesResult.error ?? pharmaciesResult.error;
      if (loadError) {
        if (active) {
          setMessage(loadError.message);
          setIsLoading(false);
        }
        return;
      }

      const pharmaciesByOwner = new Map(
        (pharmaciesResult.data ?? []).map((pharmacy) => [pharmacy.owner_user_id, pharmacy]),
      );

      if (active) {
        setIsSuperadmin(true);
        setUsers((profilesResult.data ?? []).map((profile) => ({
          ...profile,
          pharmacy: pharmaciesByOwner.get(profile.id) ?? null,
        })));
        setMessage("");
        setIsLoading(false);
      }
    }

    void loadUsers().catch((error: unknown) => {
      if (active) {
        setMessage(error instanceof Error ? error.message : "Unable to load user accounts.");
        setIsLoading(false);
      }
    });

    return () => {
      active = false;
    };
  }, [refreshKey, router]);

  async function addAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setMessage("");

    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session) {
        setMessage(sessionError?.message ?? "Sign in again to create an admin account.");
        return;
      }

      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(adminForm),
      });
      const result = await response.json() as { error?: string; user?: { email: string } };

      if (!response.ok) {
        setMessage(result.error ?? "Could not create admin account.");
        return;
      }

      setAdminForm({ email: "", fullName: "", username: "", phone: "", password: "" });
      setMessage(`Admin account created for ${result.user?.email ?? "the new user"}.`);
      setRefreshKey((current) => current + 1);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not reach the admin account service.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <AdminDashboardShell>
      <main style={{ width: "100%", maxWidth: 1440, margin: "0 auto", padding: "28px clamp(16px, 3vw, 38px) 44px" }}>
        <div style={{ marginBottom: 22 }}>
          <div style={{ color: "#78867f", fontSize: 11, marginBottom: 6 }}>Admin workspace</div>
          <h1 style={{ margin: 0, color: "#1d2c25", fontSize: 26, lineHeight: 1.2, fontWeight: 750 }}>User Management</h1>
          <p style={{ margin: "7px 0 0", color: "#78867f", fontSize: 12 }}>Pharmacy accounts and admin access</p>
        </div>

        <section aria-label="User metrics" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginBottom: 18 }}>
          {[ ["Total users", users.length], ["Admin users", users.filter((user) => user.role !== "pharmacy_user").length], ["Pharmacy users", users.filter((user) => user.role === "pharmacy_user").length]].map(([label, value]) => (
            <article key={label} style={{ minHeight: 95, display: "grid", alignContent: "space-between", gap: 12, padding: "14px 15px", border: "1px solid #e3e9e4", borderRadius: 8, background: "#fff" }}>
              <span style={{ color: "#68776f", fontSize: 11 }}>{label}</span>
              <strong style={{ color: "#203128", fontSize: 20 }}>{value}</strong>
            </article>
          ))}</section>

        <section aria-label="Add admin user" style={{ marginBottom: 18, border: "1px solid #e3e9e4", borderRadius: 8, background: "#fff", overflow: "hidden" }}>
          <div style={{ padding: "16px 18px", borderBottom: "1px solid #edf0ed" }}>
            <h2 style={{ margin: 0, color: "#20312a", fontSize: 15, fontWeight: 700 }}>Add admin-dashboard user</h2>
            <p style={{ margin: "5px 0 0", color: "#7a8981", fontSize: 11 }}>Create an admin account directly from the superadmin dashboard.</p>
          </div>
          <form onSubmit={addAdmin} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", alignItems: "end", gap: 8, padding: "14px 18px" }}>
            <label style={{ display: "grid", gap: 5, color: "#66756d", fontSize: 11 }}>Full name<input aria-label="Admin full name" required value={adminForm.fullName} onChange={(event) => setAdminForm((current) => ({ ...current, fullName: event.target.value }))} style={inputStyle} /></label>
            <label style={{ display: "grid", gap: 5, color: "#66756d", fontSize: 11 }}>Username<input aria-label="Admin username" required minLength={3} value={adminForm.username} onChange={(event) => setAdminForm((current) => ({ ...current, username: event.target.value }))} style={inputStyle} /></label>
            <label style={{ display: "grid", gap: 5, color: "#66756d", fontSize: 11 }}>Email<input aria-label="Admin email" required type="email" value={adminForm.email} onChange={(event) => setAdminForm((current) => ({ ...current, email: event.target.value }))} style={inputStyle} /></label>
            <label style={{ display: "grid", gap: 5, color: "#66756d", fontSize: 11 }}>Phone<input aria-label="Admin phone" type="tel" value={adminForm.phone} onChange={(event) => setAdminForm((current) => ({ ...current, phone: event.target.value }))} style={inputStyle} /></label>
            <label style={{ display: "grid", gap: 5, color: "#66756d", fontSize: 11 }}>Temporary password<input aria-label="Temporary password" required type="password" minLength={8} value={adminForm.password} onChange={(event) => setAdminForm((current) => ({ ...current, password: event.target.value }))} style={inputStyle} /></label>
            <button type="submit" disabled={isSaving || !isSuperadmin} style={{ ...buttonStyle, minHeight: 34, border: 0, background: isSaving ? "#9bb8a9" : "#18845d", color: "#fff", opacity: isSuperadmin ? 1 : 0.6 }}>Create admin</button>
          </form>
        </section>

        {message && <p role="status" style={{ margin: "0 0 14px", color: message.startsWith("Admin account created") ? "#267451" : "#a0443c", fontSize: 12 }}>{message}</p>}

        <section style={{ border: "1px solid #e3e9e4", borderRadius: 8, background: "#fff", overflow: "hidden" }}>
          <div style={{ padding: "16px 18px", borderBottom: "1px solid #edf0ed" }}>
            <h2 style={{ margin: 0, color: "#20312a", fontSize: 15, fontWeight: 700 }}>User accounts</h2>
            <p style={{ margin: "5px 0 0", color: "#7a8981", fontSize: 11 }}>Pharmacy users and admins can sign in immediately after registration.</p>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: 1120, borderCollapse: "collapse", textAlign: "left" }}>
              <thead><tr>{["Name", "Username", "Email", "Phone", "Store", "Company", "Location", "Role"].map((column) => <th key={column} style={{ padding: "10px 12px", background: "#f8faf8", borderBottom: "1px solid #edf0ed", color: "#78857e", fontSize: 10, fontWeight: 650, whiteSpace: "nowrap" }}>{column}</th>)}</tr></thead>
              <tbody>
                {isLoading ? <tr><td colSpan={8} style={{ padding: 28, textAlign: "center", color: "#78857e", fontSize: 12 }}>Loading accounts...</td></tr> : users.map((user) => (
                  <tr key={user.id}>
                    <td style={{ padding: 12, borderBottom: "1px solid #f0f2f0", color: "#26372f", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>{user.full_name}</td>
                    <td style={{ padding: 12, borderBottom: "1px solid #f0f2f0", color: "#64736b", fontSize: 11 }}>{user.username}</td>
                    <td style={{ padding: 12, borderBottom: "1px solid #f0f2f0", color: "#64736b", fontSize: 11, whiteSpace: "nowrap" }}>{user.email}</td>
                    <td style={{ padding: 12, borderBottom: "1px solid #f0f2f0", color: "#64736b", fontSize: 11, whiteSpace: "nowrap" }}>{user.phone || "-"}</td>
                    <td style={{ padding: 12, borderBottom: "1px solid #f0f2f0", color: "#26372f", fontSize: 11, whiteSpace: "nowrap" }}>{user.pharmacy?.store_name || "-"}</td>
                    <td style={{ padding: 12, borderBottom: "1px solid #f0f2f0", color: "#64736b", fontSize: 11, whiteSpace: "nowrap" }}>{user.pharmacy?.company_name || "-"}</td>
                    <td style={{ padding: 12, borderBottom: "1px solid #f0f2f0", color: "#64736b", fontSize: 11 }}>{user.pharmacy ? [user.pharmacy.address, user.pharmacy.city, user.pharmacy.country].filter(Boolean).join(", ") : "-"}</td>
                    <td style={{ padding: 12, borderBottom: "1px solid #f0f2f0", color: "#64736b", fontSize: 11 }}>{user.role}</td>
                  </tr>
                ))}
                {!isLoading && !users.length && <tr><td colSpan={8} style={{ padding: 32, textAlign: "center", color: "#78857e", fontSize: 12 }}>No accounts found.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </AdminDashboardShell>
  );
}
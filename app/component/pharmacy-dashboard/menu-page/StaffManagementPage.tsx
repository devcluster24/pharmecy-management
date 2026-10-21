"use client";

import { useCallback, useEffect, useState } from "react";
import DashboardSectionPage, { type SectionData } from "../DashboardSectionPage";
import DashboardSectionInvoiceTable from "../DashboardSectionInvoiceTable";
import ExcelExportButton from "../components/ExcelExportButton";
import { dashboardNavItems } from "../navigation";
import { supabase } from "@/lib/supabase/client";
import { confirmDelete } from "@/lib/confirmDelete";
import type { StaffPermissions } from "@/lib/pharmacy-staff-permissions";

type StaffStatus = "pending" | "approved" | "rejected" | "suspended";
type StaffRole = "Manager" | "Pharmacist" | "Cashier" | "Inventory Staff" | "Sales Staff" | "Staff";
type StaffMember = {
  staff_user_id: string;
  email: string;
  full_name: string;
  photo_url: string | null;
  approval_status: StaffStatus;
  created_at: string;
  staff_role: StaffRole;
  permissions: StaffPermissions;
};
type StaffDialogMode = "permissions" | "edit";

const staffRoles: StaffRole[] = [
  "Manager",
  "Pharmacist",
  "Cashier",
  "Inventory Staff",
  "Sales Staff",
  "Staff",
];
const rolePageAccess: Record<StaffRole, string[]> = {
  Manager: ["overview", "product-management", "sales", "invoice", "purchase", "inventory", "returns", "customers", "suppliers", "reports", "expenses", "settings"],
  Pharmacist: ["overview", "product-management", "sales", "invoice", "inventory", "returns", "customers"],
  Cashier: ["overview", "sales", "invoice", "customers"],
  "Inventory Staff": ["overview", "product-management", "purchase", "inventory", "returns", "suppliers"],
  "Sales Staff": ["overview", "sales", "invoice", "customers"],
  Staff: [],
};
const roleDescriptions: Record<StaffRole, string> = {
  Manager: "Broad access across pharmacy operations and reports.",
  Pharmacist: "Product, sales, inventory and customer workflows.",
  Cashier: "Sales, invoices and customer lookup.",
  "Inventory Staff": "Products, purchasing, inventory and suppliers.",
  "Sales Staff": "Sales and invoice workflows with customer access.",
  Staff: "Start with no menu access and grant only what is needed.",
};
const staffPages = dashboardNavItems.map((item) => ({
  key: item.slug || "overview",
  label: item.label,
  icon: item.icon,
})).filter((page) => page.key !== "staff");
const pageData: SectionData = {
  description: "Create a unique signup link for a staff member.",
  action: "Create Staff URL",
  metrics: [],
  columns: [],
  rows: [],
};
const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  border: "1px solid #dce5df",
  borderRadius: 6,
  padding: "9px 10px",
  color: "#26352f",
  fontSize: 13,
};

function hasPageAccess(permissions: StaffPermissions, page: string) {
  const pageAccess = permissions[page];
  return typeof pageAccess === "boolean" ? pageAccess : pageAccess?.view === true;
}

function normalizePermissions(permissions: StaffPermissions): StaffPermissions {
  return Object.fromEntries(
    Object.keys(permissions).map((page) => [page, hasPageAccess(permissions, page)]),
  );
}

function getPhotoBackground(photoUrl: string): React.CSSProperties {
  try {
    const url = new URL(photoUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return {};
    return { backgroundImage: `url("${url.href.replaceAll('"', "%22")}")` };
  } catch {
    return {};
  }
}

function getInitialRolePermissions(role: StaffRole): StaffPermissions {
  return Object.fromEntries(staffPages.map(({ key }) => [key, rolePageAccess[role].includes(key)]));
}

async function hashToken(token: string) {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export default function StaffManagementPage() {
  const [inviteUrl, setInviteUrl] = useState("");
  const [message, setMessage] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([]);
  const [isLoadingStaff, setIsLoadingStaff] = useState(true);
  const [staffError, setStaffError] = useState("");
  const [updatingStaffId, setUpdatingStaffId] = useState("");
  const [dialogMode, setDialogMode] = useState<StaffDialogMode | null>(null);
  const [selectedStaff, setSelectedStaff] = useState<StaffMember | null>(null);
  const [fullNameDraft, setFullNameDraft] = useState("");
  const [roleDraft, setRoleDraft] = useState<StaffRole>("Staff");
  const [permissionsDraft, setPermissionsDraft] = useState<StaffPermissions>({});
  const [statusDraft, setStatusDraft] = useState<"approved" | "suspended">("suspended");
  const [staffSearch, setStaffSearch] = useState("");

  const loadStaffMembers = useCallback(async () => {
    setStaffError("");
    const { data, error } = await supabase.rpc("get_pharmacy_staff_members");
    if (error) {
      setStaffError(error.message);
      setIsLoadingStaff(false);
      return;
    }
    setStaffMembers((data ?? []) as StaffMember[]);
    setIsLoadingStaff(false);
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadStaffMembers(), 0);
    return () => window.clearTimeout(timeout);
  }, [loadStaffMembers]);

  function openStaffDialog(member: StaffMember, mode: StaffDialogMode) {
    const role = staffRoles.includes(member.staff_role) ? member.staff_role : "Staff";
    setSelectedStaff(member);
    setDialogMode(mode);
    setFullNameDraft(member.full_name);
    setRoleDraft(role);
    setPermissionsDraft(normalizePermissions(member.permissions ?? {}));
    setStatusDraft(member.approval_status === "approved" ? "approved" : "suspended");
    setStaffError("");
  }

  function closeStaffDialog() {
    setDialogMode(null);
    setSelectedStaff(null);
  }

  function changeRole(role: StaffRole) {
    setRoleDraft(role);
    setPermissionsDraft(getInitialRolePermissions(role));
  }

  function updatePageAccess(page: string, checked: boolean) {
    setPermissionsDraft((permissions) => ({ ...permissions, [page]: checked }));
  }

  async function saveStaff(
    member: StaffMember,
    options: {
      permissions?: StaffPermissions;
      role?: StaffRole;
      status?: "approved" | "suspended";
      fullName?: string;
    },
  ) {
    setUpdatingStaffId(member.staff_user_id);
    setStaffError("");
    try {
      const { error } = await supabase.rpc("manage_pharmacy_staff_access", {
        target_staff_user_id: member.staff_user_id,
        requested_decision: "update",
        requested_permissions: normalizePermissions(options.permissions ?? member.permissions),
        requested_role: options.role ?? member.staff_role,
        requested_status: options.status ?? member.approval_status,
        requested_full_name: options.fullName ?? member.full_name,
      });
      if (error) throw error;
      await loadStaffMembers();
      if (dialogMode) closeStaffDialog();
    } catch (error) {
      setStaffError(error instanceof Error ? error.message : "Could not update staff access.");
    } finally {
      setUpdatingStaffId("");
    }
  }

  async function toggleStaffStatus(member: StaffMember) {
    await saveStaff(member, {
      status: member.approval_status === "approved" ? "suspended" : "approved",
    });
  }

  async function deleteStaff(member: StaffMember) {
    if (!await confirmDelete(`Permanently delete ${member.full_name || member.email}'s staff account?`)) return;

    setUpdatingStaffId(member.staff_user_id);
    setStaffError("");
    try {
      const { error } = await supabase.rpc("delete_pharmacy_staff_member", {
        target_staff_user_id: member.staff_user_id,
      });
      if (error) throw error;
      setStaffMembers((members) => members.filter((item) => item.staff_user_id !== member.staff_user_id));
    } catch (error) {
      setStaffError(error instanceof Error ? error.message : "Could not delete this staff account.");
    } finally {
      setUpdatingStaffId("");
    }
  }

  async function createStaffUrl() {
    setIsCreating(true);
    setInviteUrl("");
    setMessage("");
    setIsCopied(false);
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session?.user) throw new Error("Sign in again before creating a staff signup link.");

      const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
      const token = Array.from(tokenBytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
      const tokenHash = await hashToken(token);
      const { error } = await supabase.rpc("create_pharmacy_staff_invite", {
        requested_token_hash: tokenHash,
      });
      if (error) throw error;

      setInviteUrl(`${window.location.origin}/staff-signup/${token}`);
      setMessage("This private link accepts one staff application and expires in 30 days.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create a staff signup link.");
    } finally {
      setIsCreating(false);
    }
  }

  async function copyInviteUrl() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setIsCopied(true);
      setMessage("Signup link copied. Share it only with the intended staff member.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not copy the signup link.");
    }
  }

  const actionContent = (
    <button
      type="button"
      disabled={isCreating}
      onClick={() => void createStaffUrl()}
      style={{ border: 0, borderRadius: 7, background: "#179c70", color: "#fff", padding: "10px 14px", fontSize: 13, fontWeight: 650, cursor: isCreating ? "wait" : "pointer", opacity: isCreating ? 0.7 : 1 }}
    >
      {isCreating ? "Creating link..." : "Create Staff URL"}
    </button>
  );

  const isSelectedStaffSaving = selectedStaff?.staff_user_id === updatingStaffId;
  const selectedPageCount = staffPages.filter((page) => hasPageAccess(permissionsDraft, page.key)).length;
  const filteredStaffMembers = staffMembers.filter((member) => {
    const query = staffSearch.trim().toLocaleLowerCase();
    return !query || [
      member.full_name,
      member.email,
      member.staff_role,
      member.approval_status,
    ].some((value) => value.toLocaleLowerCase().includes(query));
  });

  function renderStaffPhoto(member: StaffMember) {
    return member.photo_url ? (
      <span role="img" aria-label={`${member.full_name || "Staff"} profile photo`} style={{ display: "block", width: 38, height: 38, borderRadius: "50%", backgroundColor: "#edf2ee", backgroundSize: "cover", backgroundPosition: "center", ...getPhotoBackground(member.photo_url) }} />
    ) : (
      <span aria-label="No profile photo" style={{ display: "grid", placeItems: "center", width: 38, height: 38, borderRadius: "50%", background: "#edf2ee", color: "#52625a", fontSize: 14, fontWeight: 650 }}>
        {(member.full_name || member.email || "?").trim().charAt(0).toUpperCase()}
      </span>
    );
  }

  function renderStaffStatus(member: StaffMember) {
    const isActive = member.approval_status === "approved";
    const isSaving = updatingStaffId === member.staff_user_id;
    return (
      <button
        type="button"
        className="dashboard-staff-status-toggle"
        role="switch"
        aria-checked={isActive}
        aria-label={`${isActive ? "Deactivate" : "Activate"} ${member.full_name || member.email}`}
        disabled={isSaving}
        onClick={() => void toggleStaffStatus(member)}
        style={{ display: "inline-flex", alignItems: "center", gap: 8, border: 0, background: "transparent", color: isActive ? "#276749" : "#8a655f", padding: 0, fontSize: 12, fontWeight: 650, cursor: isSaving ? "wait" : "pointer", whiteSpace: "nowrap" }}
      >
        <span className="dashboard-staff-status-track" style={{ display: "inline-flex", alignItems: "center", width: 34, height: 19, borderRadius: 10, padding: 2, background: isActive ? "#179c70" : "#c8ceca", boxSizing: "border-box" }}>
          <span style={{ width: 15, height: 15, borderRadius: "50%", background: "#fff", transform: isActive ? "translateX(15px)" : "translateX(0)", transition: "transform 0.15s ease" }} />
        </span>
        {isActive ? "Active" : "Inactive"}
      </button>
    );
  }

  function renderStaffActions(member: StaffMember) {
    const isSaving = updatingStaffId === member.staff_user_id;
    return (
      <div className="dashboard-staff-row-actions" style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
        <button className="dashboard-staff-row-action" type="button" disabled={isSaving} onClick={() => openStaffDialog(member, "permissions")} style={{ border: "1px solid #dce5df", borderRadius: 5, background: "#fff", color: "#26352f", padding: "7px 9px", fontSize: 11, cursor: isSaving ? "wait" : "pointer" }}>Permission</button>
        <button className="dashboard-staff-row-action" type="button" disabled={isSaving} onClick={() => openStaffDialog(member, "edit")} style={{ border: "1px solid #dce5df", borderRadius: 5, background: "#fff", color: "#26352f", padding: "7px 9px", fontSize: 11, cursor: isSaving ? "wait" : "pointer" }}>Edit</button>
        <button className="dashboard-staff-row-action" type="button" disabled={isSaving} onClick={() => void deleteStaff(member)} style={{ border: "1px solid #ead3d0", borderRadius: 5, background: "#fff", color: "#ad4b43", padding: "7px 9px", fontSize: 11, cursor: isSaving ? "wait" : "pointer" }}>Delete</button>
      </div>
    );
  }

  const mobileStaffRows: React.ReactNode[][] = filteredStaffMembers.map((member) => [
    renderStaffPhoto(member),
    member.full_name || "—",
    member.email,
    renderStaffStatus(member),
    member.staff_role,
    renderStaffActions(member),
  ]);

  return (
    <DashboardSectionPage
      sectionSlug="staff"
      data={pageData}
      actionContent={actionContent}
      content={
        <div className="dashboard-staff-content" style={{ display: "grid", gap: 22, marginTop: 24 }}>
          <section className="dashboard-staff-invite" aria-live="polite" style={{ maxWidth: 760, padding: 22, border: "1px solid #e4e9e5", borderRadius: 8, background: "#fff" }}>
            <h2 style={{ margin: 0, color: "#26352f", fontSize: 16 }}>Create staff signup link</h2>
            <p style={{ margin: "9px 0 16px", color: "#687871", fontSize: 12, lineHeight: 1.6 }}>
              Staff can use this link to apply with email and password or Google. Set their role, menu access, and account status before allowing dashboard access.
            </p>
            {message && <p role="status" style={{ margin: "0 0 12px", color: inviteUrl ? "#276749" : "#ad4b43", fontSize: 12, lineHeight: 1.5 }}>{message}</p>}
            {inviteUrl && (
              <div className="dashboard-staff-invite-link" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input
                  aria-label="Staff signup URL"
                  readOnly
                  value={inviteUrl}
                  onFocus={(event) => event.currentTarget.select()}
                  style={{ flex: "1 1 360px", minWidth: 0, boxSizing: "border-box", border: "1px solid #dce5df", borderRadius: 6, padding: "9px 10px", color: "#26352f", fontSize: 12 }}
                />
                <button
                  type="button"
                  onClick={() => void copyInviteUrl()}
                  style={{ border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#26352f", padding: "9px 12px", fontSize: 12, fontWeight: 650, cursor: "pointer" }}
                >
                  {isCopied ? "Copied" : "Copy URL"}
                </button>
              </div>
            )}
          </section>

          <section className="dashboard-staff-list" style={{ padding: 22, border: "1px solid #e4e9e5", borderRadius: 8, background: "#fff" }}>
            <header className="dashboard-staff-list-header">
              <div>
                <h2 style={{ margin: 0, color: "#26352f", fontSize: 16 }}>Staff applications and access</h2>
                <p style={{ margin: "8px 0 18px", color: "#687871", fontSize: 12, lineHeight: 1.6 }}>
                  Assign a role and menu access for each staff member. Active staff can sign in; suspended staff are blocked.
                </p>
              </div>
              {!isLoadingStaff && (
                <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                  <ExcelExportButton
                    fileName="Staff"
                    sheets={[{
                      name: "Staff",
                      columns: ["Full Name", "Email", "Role", "Status", "Created At"],
                      rows: filteredStaffMembers.map((member) => [
                        member.full_name,
                        member.email,
                        member.staff_role,
                        member.approval_status,
                        member.created_at,
                      ]),
                    }]}
                  />
                  {staffMembers.length > 0 && (
                    <input className="dashboard-staff-search" aria-label="Search staff" value={staffSearch} onChange={(event) => setStaffSearch(event.currentTarget.value)} placeholder="Search staff..." />
                  )}
                </div>
              )}
            </header>
            {staffError && <p role="alert" style={{ color: "#ad4b43", fontSize: 12 }}>{staffError}</p>}
            {isLoadingStaff ? (
              <p role="status" style={{ color: "#687871", fontSize: 13 }}>Loading staff applications...</p>
            ) : staffMembers.length === 0 ? (
              <p style={{ color: "#687871", fontSize: 13 }}>No staff applications yet. Staff who sign up with your link will appear here.</p>
            ) : (
              <>
              <div className="dashboard-staff-desktop-table" style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", minWidth: 760, borderCollapse: "collapse", textAlign: "left" }}>
                  <thead>
                    <tr>
                      {["Profile Photo", "Full Name", "Email", "Status", "Actions"].map((heading) => (
                        <th key={heading} scope="col" style={{ padding: "11px 10px", borderBottom: "1px solid #e4e9e5", color: "#687871", fontSize: 11, fontWeight: 650 }}>{heading}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStaffMembers.map((member) => {
                      return (
                        <tr key={member.staff_user_id}>
                          <td style={{ padding: "12px 10px", borderBottom: "1px solid #eef1ee" }}>
                            {renderStaffPhoto(member)}
                          </td>
                          <td style={{ padding: "12px 10px", borderBottom: "1px solid #eef1ee", color: "#26352f", fontSize: 13, fontWeight: 600 }}>{member.full_name || "—"}</td>
                          <td style={{ padding: "12px 10px", borderBottom: "1px solid #eef1ee", color: "#687871", fontSize: 12 }}>{member.email}</td>
                          <td style={{ padding: "12px 10px", borderBottom: "1px solid #eef1ee" }}>
                            {renderStaffStatus(member)}
                          </td>
                          <td style={{ padding: "12px 10px", borderBottom: "1px solid #eef1ee" }}>
                            {renderStaffActions(member)}
                          </td>
                        </tr>
                      );
                    })}
                    {filteredStaffMembers.length === 0 && (
                      <tr><td colSpan={5} style={{ padding: 20, color: "#687871", fontSize: 12, textAlign: "center" }}>No staff members match this search.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="dashboard-staff-mobile-table">
                <DashboardSectionInvoiceTable
                columns={["Profile", "Full name", "Email", "Status", "Role", "Actions"]}
                rows={mobileStaffRows}
                rowKeys={filteredStaffMembers.map((member) => member.staff_user_id)}
                mobileOnly
                syncMobileScroll
                />
              </div>
              </>
            )}
          </section>

          {dialogMode && selectedStaff && (
            <div
              onMouseDown={(event) => {
                if (event.target === event.currentTarget && !isSelectedStaffSaving) closeStaffDialog();
              }}
              className="dashboard-staff-dialog-backdrop"
              style={{ position: "fixed", inset: 0, zIndex: 1000, display: "grid", placeItems: "center", background: "rgba(21, 33, 27, 0.56)", backdropFilter: "blur(5px)", padding: 16 }}
            >
              <section className="dashboard-staff-dialog" role="dialog" aria-modal="true" aria-labelledby="staff-dialog-title" style={{ display: "flex", flexDirection: "column", width: "min(760px, 100%)", maxHeight: "92vh", overflow: "hidden", border: "1px solid #e7ece8", borderRadius: 16, background: "#f7f9f7", boxShadow: "0 28px 90px rgba(0,0,0,0.28)" }}>
                <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "20px 24px", borderBottom: "1px solid #e7ece8", background: "#fff" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 13, minWidth: 0 }}>
                    {selectedStaff.photo_url ? (
                      <span role="img" aria-label={`${selectedStaff.full_name || "Staff"} profile photo`} style={{ flex: "0 0 auto", display: "block", width: 46, height: 46, borderRadius: 14, backgroundColor: "#edf2ee", backgroundSize: "cover", backgroundPosition: "center", ...getPhotoBackground(selectedStaff.photo_url) }} />
                    ) : (
                      <span style={{ flex: "0 0 auto", display: "grid", placeItems: "center", width: 46, height: 46, borderRadius: 14, background: "#e7f4ed", color: "#18794e", fontSize: 17, fontWeight: 750 }}>
                        {(fullNameDraft || selectedStaff.email).trim().charAt(0).toUpperCase()}
                      </span>
                    )}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <h2 id="staff-dialog-title" style={{ margin: 0, color: "#1e3028", fontSize: 18, letterSpacing: "-0.02em" }}>{dialogMode === "edit" ? "Edit staff profile" : "Staff access & permissions"}</h2>
                        <span style={{ borderRadius: 20, background: selectedStaff.approval_status === "approved" ? "#e8f6ee" : "#fff4e5", color: selectedStaff.approval_status === "approved" ? "#18794e" : "#946200", padding: "4px 9px", fontSize: 10, fontWeight: 700 }}>
                          {selectedStaff.approval_status === "approved" ? "ACTIVE" : "INACTIVE"}
                        </span>
                      </div>
                      <p style={{ overflow: "hidden", margin: "5px 0 0", color: "#718078", fontSize: 12, textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedStaff.email}</p>
                    </div>
                  </div>
                  <button type="button" aria-label="Close" disabled={isSelectedStaffSaving} onClick={closeStaffDialog} style={{ flex: "0 0 auto", display: "grid", placeItems: "center", width: 34, height: 34, border: "1px solid #e6ebe7", borderRadius: 9, background: "#fff", color: "#687871", fontSize: 20, cursor: "pointer" }}>×</button>
                </header>

                <div style={{ display: "grid", gap: 13, overflowY: "auto", padding: 20 }}>
                  <section style={{ padding: 17, border: "1px solid #e7ece8", borderRadius: 12, background: "#fff" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 15 }}>
                      <span style={{ display: "grid", placeItems: "center", width: 27, height: 27, borderRadius: 8, background: "#eef6f1", color: "#23845a", fontSize: 12, fontWeight: 750 }}>01</span>
                      <div>
                        <h3 style={{ margin: 0, color: "#26352f", fontSize: 13 }}>Staff information</h3>
                        <p style={{ margin: "3px 0 0", color: "#89958e", fontSize: 11 }}>Basic account details</p>
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 12 }}>
                      <div>
                        <label htmlFor="staff-full-name" style={{ display: "block", marginBottom: 6, color: "#52625a", fontSize: 11, fontWeight: 650 }}>Full name</label>
                        <input id="staff-full-name" value={fullNameDraft} disabled={dialogMode !== "edit" || isSelectedStaffSaving} onChange={(event) => setFullNameDraft(event.currentTarget.value)} style={{ ...inputStyle, borderRadius: 8, padding: "10px 11px", background: dialogMode !== "edit" ? "#f7f9f7" : "#fff" }} />
                      </div>
                      <div>
                        <label htmlFor="staff-email" style={{ display: "block", marginBottom: 6, color: "#52625a", fontSize: 11, fontWeight: 650 }}>Email address</label>
                        <input id="staff-email" type="email" readOnly value={selectedStaff.email} style={{ ...inputStyle, borderRadius: 8, padding: "10px 11px", background: "#f7f9f7", color: "#78857e" }} />
                      </div>
                    </div>
                  </section>

                  {dialogMode === "permissions" && (
                    <>
                      <section style={{ padding: 17, border: "1px solid #e7ece8", borderRadius: 12, background: "#fff" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                          <span style={{ display: "grid", placeItems: "center", width: 27, height: 27, borderRadius: 8, background: "#eef6f1", color: "#23845a", fontSize: 12, fontWeight: 750 }}>02</span>
                          <div>
                            <h3 style={{ margin: 0, color: "#26352f", fontSize: 13 }}>Role management</h3>
                            <p style={{ margin: "3px 0 0", color: "#89958e", fontSize: 11 }}>Pick a role to set suggested menu access</p>
                          </div>
                        </div>
                        <label htmlFor="staff-role" style={{ display: "block", marginBottom: 6, color: "#52625a", fontSize: 11, fontWeight: 650 }}>Staff role</label>
                        <select id="staff-role" value={roleDraft} disabled={isSelectedStaffSaving} onChange={(event) => changeRole(event.currentTarget.value as StaffRole)} style={{ ...inputStyle, borderRadius: 8, padding: "10px 11px", background: "#fff" }}>
                          {staffRoles.map((role) => <option key={role} value={role}>{role}</option>)}
                        </select>
                        <p style={{ margin: "8px 0 0", color: "#718078", fontSize: 11, lineHeight: 1.5 }}>{roleDescriptions[roleDraft]}</p>
                      </section>

                      <section style={{ padding: 17, border: "1px solid #e7ece8", borderRadius: 12, background: "#fff" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{ display: "grid", placeItems: "center", width: 27, height: 27, borderRadius: 8, background: "#eef6f1", color: "#23845a", fontSize: 12, fontWeight: 750 }}>03</span>
                            <div>
                              <h3 style={{ margin: 0, color: "#26352f", fontSize: 13 }}>Menu access</h3>
                              <p style={{ margin: "3px 0 0", color: "#89958e", fontSize: 11 }}>Choose the pages this staff member can open</p>
                            </div>
                          </div>
                          <span style={{ borderRadius: 20, background: "#f0f4f1", color: "#52625a", padding: "5px 9px", fontSize: 10, fontWeight: 700 }}>{selectedPageCount} / {staffPages.length} pages</span>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(185px, 1fr))", gap: 8 }}>
                          {staffPages.map((page) => {
                            const isAllowed = hasPageAccess(permissionsDraft, page.key);
                            return (
                              <label key={page.key} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, boxSizing: "border-box", padding: "9px 11px", border: `1px solid ${isAllowed ? "#b8dfca" : "#e7ece8"}`, borderRadius: 9, background: isAllowed ? "#f1f9f4" : "#fff", color: isAllowed ? "#245c40" : "#52625a", fontSize: 12, fontWeight: isAllowed ? 650 : 500, cursor: isSelectedStaffSaving ? "wait" : "pointer", transition: "border-color 0.15s ease, background 0.15s ease" }}>
                                <input type="checkbox" checked={isAllowed} disabled={isSelectedStaffSaving} onChange={(event) => updatePageAccess(page.key, event.currentTarget.checked)} style={{ width: 15, height: 15, margin: 0, accentColor: "#179c70" }} />
                                <span style={{ display: "grid", placeItems: "center", width: 20, height: 20, borderRadius: 6, background: isAllowed ? "#e0f1e7" : "#f2f4f2", color: isAllowed ? "#23845a" : "#7a8780", fontSize: 12 }}>{page.icon}</span>
                                <span>{page.label}</span>
                              </label>
                            );
                          })}
                        </div>
                        <p style={{ margin: "12px 0 0", color: "#89958e", fontSize: 10, lineHeight: 1.5 }}>Access here controls menu visibility and page access only.</p>
                      </section>

                      <section style={{ padding: 17, border: "1px solid #e7ece8", borderRadius: 12, background: "#fff" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                          <span style={{ display: "grid", placeItems: "center", width: 27, height: 27, borderRadius: 8, background: "#eef6f1", color: "#23845a", fontSize: 12, fontWeight: 750 }}>04</span>
                          <div>
                            <h3 style={{ margin: 0, color: "#26352f", fontSize: 13 }}>Account status</h3>
                            <p style={{ margin: "3px 0 0", color: "#89958e", fontSize: 11 }}>Control whether this staff member can sign in</p>
                          </div>
                        </div>
                        <label htmlFor="staff-account-status" style={{ display: "block", marginBottom: 6, color: "#52625a", fontSize: 11, fontWeight: 650 }}>Login access</label>
                        <select id="staff-account-status" value={statusDraft} disabled={isSelectedStaffSaving} onChange={(event) => setStatusDraft(event.currentTarget.value as "approved" | "suspended")} style={{ ...inputStyle, borderRadius: 8, padding: "10px 11px", borderColor: statusDraft === "approved" ? "#b8dfca" : "#f0d8b0", background: statusDraft === "approved" ? "#f5fbf7" : "#fffaf2" }}>
                          <option value="approved">Active — can sign in</option>
                          <option value="suspended">Inactive — sign-in blocked</option>
                        </select>
                      </section>
                    </>
                  )}
                </div>

                <footer style={{ padding: "14px 20px", borderTop: "1px solid #e7ece8", background: "#fff" }}>
                  {staffError && <p role="alert" style={{ margin: "0 0 12px", color: "#ad4b43", fontSize: 12 }}>{staffError}</p>}
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                    <button type="button" disabled={isSelectedStaffSaving} onClick={closeStaffDialog} style={{ border: "1px solid #dce5df", borderRadius: 8, background: "#fff", color: "#52625a", padding: "10px 15px", fontSize: 12, fontWeight: 600, cursor: isSelectedStaffSaving ? "wait" : "pointer" }}>Cancel</button>
                    <button
                      type="button"
                      disabled={isSelectedStaffSaving || !fullNameDraft.trim()}
                      onClick={() => void saveStaff(selectedStaff, {
                        fullName: fullNameDraft.trim(),
                        ...(dialogMode === "permissions" ? {
                          permissions: permissionsDraft,
                          role: roleDraft,
                          status: statusDraft,
                        } : {}),
                      })}
                      style={{ border: 0, borderRadius: 8, background: "#16845d", color: "#fff", padding: "10px 17px", fontSize: 12, fontWeight: 700, cursor: isSelectedStaffSaving ? "wait" : "pointer", boxShadow: "0 2px 5px rgba(22,132,93,0.2)", opacity: isSelectedStaffSaving || !fullNameDraft.trim() ? 0.7 : 1 }}
                    >
                      {isSelectedStaffSaving ? "Saving changes..." : "Save changes"}
                    </button>
                  </div>
                </footer>
              </section>
            </div>
          )}
        </div>
      }
    />
  );
}

export type StaffPageAction = "view" | "create" | "edit" | "delete";
export type StaffPagePermissions = Partial<Record<StaffPageAction, boolean>>;
export type StaffPageAccess = boolean | StaffPagePermissions;
export type StaffPermissions = Record<string, StaffPageAccess>;

let isStaffSession = false;
let currentPermissions: StaffPermissions = {};

export function setPharmacyStaffPermissions(isStaff: boolean, permissions: StaffPermissions) {
  isStaffSession = isStaff;
  currentPermissions = permissions;
}

export function clearPharmacyStaffPermissions() {
  isStaffSession = false;
  currentPermissions = {};
}

export function canPharmacyStaffAccess(page: string, action: StaffPageAction = "view") {
  const pageAccess = currentPermissions[page];
  if (!isStaffSession) return true;
  if (typeof pageAccess === "boolean") return pageAccess;
  return pageAccess?.[action] === true;
}

export function assertPharmacyStaffAccess(page: string, action: StaffPageAction) {
  if (!canPharmacyStaffAccess(page, action)) {
    throw new Error(`Your pharmacy owner has not granted ${action} access for this page.`);
  }
}

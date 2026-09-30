import DashboardSectionPage, { type SectionData } from "../DashboardSectionPage";

const pageData: SectionData = {
  description: "Manage team members, roles, and access to your store.",
  action: "Add staff member",
  metrics: [
    { label: "Team members", value: "12", detail: "Across all roles" },
    { label: "On shift", value: "4", detail: "Currently working" },
    { label: "Invitations", value: "1", detail: "Awaiting response" },
  ],
  columns: ["Name", "Role", "Phone", "Shift", "Last active", "Status"],
  rows: [
    ["Ayesha Rahman", "Store manager", "+880 1712-111222", "Morning", "Just now", "Active"],
    ["Fahim Hasan", "Pharmacist", "+880 1812-222333", "Morning", "5 min ago", "Active"],
    ["Sadia Islam", "Cashier", "+880 1912-333444", "Evening", "Yesterday", "Active"],
  ],
};

export default function StaffManagementPage() {
  return <DashboardSectionPage sectionSlug="staff" data={pageData} />;
}
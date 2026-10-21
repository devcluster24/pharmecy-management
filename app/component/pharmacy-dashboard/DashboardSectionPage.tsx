import type { ReactNode } from "react";
import DashboardSectionInvoiceTable from "./DashboardSectionInvoiceTable";
import Sidebar from "./components/Sidebar";
import PharmacyProfileMenu from "./components/PharmacyProfileMenu";
import DashboardLanguageMenu from "./components/DashboardLanguageMenu";
import PharmacyDashboardBrand, { PharmacyDashboardStoreName } from "./components/PharmacyDashboardBrand";
import { dashboardNavItems } from "./navigation";
import { SubscriptionActionLock } from "../auth/PharmacySubscriptionExpiry";

export type SectionData = {
  description: string;
  errorMessage?: string;
  action: string;
  metrics: { label: string; value: string; detail: string }[];
  columns: string[];
  rows: ReactNode[][];
  rowKeys?: string[];
  listTitle?: string;
  listNavigation?: ReactNode;
  listFooter?: ReactNode;
};

export default function DashboardSectionPage({
  sectionSlug,
  data,
  actionContent,
  hideAction = false,
  hidePageHeader = false,
  pageTitle,
  content,
  listTitle,
  listNavigation,
  searchAccessory,
  searchValue,
  onSearchChange,
}: {
  sectionSlug: string;
  data: SectionData;
  actionContent?: ReactNode;
  hideAction?: boolean;
  hidePageHeader?: boolean;
  pageTitle?: string;
  content?: ReactNode;
  listTitle?: string;
  listNavigation?: ReactNode;
  searchAccessory?: ReactNode;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
}) {
  const navItem = dashboardNavItems.find((item) => item.slug === sectionSlug);

  if (!navItem) {
    return null;
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f8f8f7", color: "#202624", fontFamily: "Inter, Arial, sans-serif" }}>
      <header
        className="dashboard-navbar"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 30,
          minHeight: 62,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          padding: "12px 24px",
          background: "#fff",
          borderBottom: "1px solid #e8e8e6",
        }}
      >
        <PharmacyDashboardBrand />
        <div className="dashboard-navbar-actions" style={{ display: "flex", alignItems: "center", gap: 16, color: "#64716d", fontSize: 12 }}>
          <DashboardLanguageMenu />
          <span className="dashboard-navbar-store-name"><PharmacyDashboardStoreName /></span>
          <PharmacyProfileMenu />
        </div>
      </header>

      <div style={{ display: "flex", minHeight: "calc(100vh - 62px)" }}>
        <Sidebar />
        <main
          className={pageTitle === "Profile"
            ? "dashboard-main-profile"
            : sectionSlug === "sales"
            ? "dashboard-main-sales"
            : sectionSlug === "invoice"
              ? "dashboard-main-invoice"
              : sectionSlug === "purchase"
                ? "dashboard-main-purchase"
                : sectionSlug === "inventory"
                  ? "dashboard-main-inventory"
                    : sectionSlug === "returns"
                      ? "dashboard-main-returns"
                        : sectionSlug === "customers"
                          ? "dashboard-main-customers"
                          : sectionSlug === "suppliers"
                            ? "dashboard-main-suppliers"
                            : sectionSlug === "reports"
                              ? "dashboard-main-reports"
                              : sectionSlug === "expenses"
                                ? "dashboard-main-expenses"
                                : sectionSlug === "staff"
                                  ? "dashboard-main-staff"
                                  : sectionSlug === "settings"
                                    ? "dashboard-main-settings"
                            : undefined}
          style={{
            flex: 1,
            minWidth: 0,
            padding: sectionSlug === "sales"
              ? "12px clamp(18px, 4vw, 48px) 12px"
              : hidePageHeader
                ? "8px clamp(18px, 4vw, 48px) 24px"
                : "32px clamp(18px, 4vw, 48px) 48px",
          }}
        >
          <SubscriptionActionLock
            showExpiryNotice={sectionSlug !== "settings"}
            locked={sectionSlug !== "settings"}
          >
          {sectionSlug !== "sales" && !hidePageHeader && (
            <div className={pageTitle === "Profile" ? "dashboard-profile-page-header" : sectionSlug === "inventory" ? "dashboard-inventory-page-header" : sectionSlug === "returns" ? "dashboard-returns-page-header" : sectionSlug === "customers" ? "dashboard-customers-page-header" : sectionSlug === "suppliers" ? "dashboard-suppliers-page-header" : sectionSlug === "expenses" ? "dashboard-expenses-page-header" : sectionSlug === "staff" ? "dashboard-staff-page-header" : undefined} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20, flexWrap: "wrap", marginBottom: 28 }}>
              <div>
                <div style={{ color: "#72807b", fontSize: 12, marginBottom: 8 }}>Pharmacy / {pageTitle ?? navItem.label}</div>
                <h1 style={{ margin: 0, color: "#172622", fontSize: 30, lineHeight: 1.2, fontWeight: 750 }}>{pageTitle ?? navItem.label}</h1>
                {data.description && (
                  <p style={{ margin: "8px 0 0", color: "#6a7973", fontSize: 14 }}>{data.description}</p>
                )}
              </div>
              {!hideAction && (actionContent ?? (
                <button type="button" style={{ border: 0, borderRadius: 7, background: "#179c70", color: "#fff", padding: "10px 14px", fontSize: 13, fontWeight: 650, cursor: "pointer" }}>
                  {data.action}
                </button>
              ))}
            </div>
          )}

          {data.errorMessage && (
            <p role="alert" style={{ margin: "0 0 18px", color: "#b34b43", fontSize: 13 }}>
              {data.errorMessage}
            </p>
          )}

          {data.metrics.length > 0 && (
            <section className={sectionSlug === "returns" ? "dashboard-returns-metrics" : sectionSlug === "suppliers" ? "dashboard-suppliers-metrics" : undefined} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14, marginBottom: 26 }}>
              {data.metrics.map((metric) => (
                <article key={metric.label} style={{ minHeight: 104, border: "1px solid #e4e9e5", borderRadius: 8, background: "#fff", padding: "16px 18px" }}>
                  <div style={{ color: "#687871", fontSize: 12 }}>{metric.label}</div>
                  <div style={{ marginTop: 9, color: "#172622", fontSize: 24, fontWeight: 700 }}>{metric.value}</div>
                  <div style={{ marginTop: 5, color: "#85918c", fontSize: 11 }}>{metric.detail}</div>
                </article>
              ))}
            </section>
          )}

          {content}

          {data.columns.length > 0 && (
            <section className={sectionSlug === "invoice" || sectionSlug === "purchase" ? "dashboard-invoice-list" : sectionSlug === "inventory" ? "dashboard-inventory-list" : sectionSlug === "returns" ? "dashboard-returns-list" : sectionSlug === "suppliers" ? "dashboard-suppliers-list" : undefined} style={{ border: "1px solid #e4e9e5", borderRadius: 8, background: "#fff", overflow: "hidden" }}>
            <div className={sectionSlug === "invoice" || sectionSlug === "purchase" ? "dashboard-invoice-list-header" : sectionSlug === "inventory" ? "dashboard-inventory-list-header" : sectionSlug === "returns" ? "dashboard-returns-list-header" : sectionSlug === "customers" ? "dashboard-customers-list-header" : sectionSlug === "suppliers" ? "dashboard-suppliers-list-header" : undefined} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", padding: "16px 18px", borderBottom: "1px solid #edf0ed" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
                {listNavigation}
                {listTitle !== "" && (
                  <h2 style={{ margin: 0, color: "#26352f", fontSize: 15, fontWeight: 700 }}>{listTitle ?? `${navItem.label} list`}</h2>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                {searchAccessory}
                <input
                  className={sectionSlug === "invoice" || sectionSlug === "purchase" ? "dashboard-invoice-search" : sectionSlug === "inventory" ? "dashboard-inventory-search" : sectionSlug === "returns" ? "dashboard-returns-search" : sectionSlug === "customers" ? "dashboard-customers-search" : sectionSlug === "suppliers" ? "dashboard-suppliers-search" : undefined}
                  aria-label={`Search ${navItem.label.toLowerCase()}`}
                  placeholder="Search..."
                  value={searchValue}
                  onChange={onSearchChange ? (event) => onSearchChange(event.target.value) : undefined}
                  style={{ width: 220, maxWidth: "100%", border: "1px solid #e0e6e1", borderRadius: 6, padding: "8px 10px", color: "#26352f", fontSize: 12, outline: "none" }}
                />
              </div>
            </div>
            {sectionSlug === "invoice" || sectionSlug === "purchase" ? (
              <DashboardSectionInvoiceTable columns={data.columns} rows={data.rows} />
            ) : sectionSlug === "inventory" ? (
              <>
                <div className="dashboard-invoice-desktop-table dashboard-inventory-table-scroll" style={{ overflowX: "auto" }}>
                  <table className="dashboard-inventory-table" style={{ width: "100%", borderCollapse: "collapse", minWidth: 680, textAlign: "left" }}>
                    <thead>
                      <tr>
                        {data.columns.map((column) => (
                          <th key={column} style={{ padding: "11px 16px", background: "#f8faf8", borderBottom: "1px solid #edf0ed", color: "#6c7a73", fontSize: 11, fontWeight: 650, whiteSpace: "nowrap" }}>{column}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.map((row, rowIndex) => (
                        <tr key={`${sectionSlug}-${data.rowKeys?.[rowIndex] ?? rowIndex}`}>
                          {row.map((cell, cellIndex) => (
                            <td key={`${sectionSlug}-${data.rowKeys?.[rowIndex] ?? rowIndex}-${cellIndex}`} style={{ padding: "13px 16px", borderBottom: rowIndex === data.rows.length - 1 ? 0 : "1px solid #f0f2f0", color: cellIndex === 0 ? "#26352f" : "#687871", fontSize: 12, fontWeight: cellIndex === 0 ? 600 : 400, whiteSpace: "nowrap" }}>{cell}</td>
                          ))}
                        </tr>
                      ))}
                      {data.rows.length === 0 && (
                        <tr>
                          <td colSpan={data.columns.length} style={{ padding: "24px 16px", color: "#87928d", fontSize: 12, textAlign: "center" }}>
                            No records found.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <DashboardSectionInvoiceTable columns={data.columns} rows={data.rows} rowKeys={data.rowKeys} mobileOnly />
              </>
            ) : sectionSlug === "returns" ? (
              <>
                <div className="dashboard-invoice-desktop-table dashboard-returns-table-scroll" style={{ overflowX: "auto" }}>
                  <table className="dashboard-returns-table" style={{ width: "100%", borderCollapse: "collapse", minWidth: 680, textAlign: "left" }}>
                    <thead>
                      <tr>
                        {data.columns.map((column) => (
                          <th key={column} style={{ padding: "11px 16px", background: "#f8faf8", borderBottom: "1px solid #edf0ed", color: "#6c7a73", fontSize: 11, fontWeight: 650, whiteSpace: "nowrap" }}>{column}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.map((row, rowIndex) => (
                        <tr key={`${sectionSlug}-${data.rowKeys?.[rowIndex] ?? rowIndex}`}>
                          {row.map((cell, cellIndex) => (
                            <td key={`${sectionSlug}-${data.rowKeys?.[rowIndex] ?? rowIndex}-${cellIndex}`} style={{ padding: "13px 16px", borderBottom: rowIndex === data.rows.length - 1 ? 0 : "1px solid #f0f2f0", color: cellIndex === 0 ? "#26352f" : "#687871", fontSize: 12, fontWeight: cellIndex === 0 ? 600 : 400, whiteSpace: "nowrap" }}>{cell}</td>
                          ))}
                        </tr>
                      ))}
                      {data.rows.length === 0 && (
                        <tr>
                          <td colSpan={data.columns.length} style={{ padding: "24px 16px", color: "#87928d", fontSize: 12, textAlign: "center" }}>
                            No records found.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="dashboard-returns-mobile-table">
                  <DashboardSectionInvoiceTable columns={data.columns} rows={data.rows} rowKeys={data.rowKeys} mobileOnly syncMobileScroll />
                </div>
              </>
            ) : sectionSlug === "customers" ? (
              <>
                <div className="dashboard-invoice-desktop-table dashboard-customers-table-scroll" style={{ overflowX: "auto" }}>
                  <table className="dashboard-customers-table" style={{ width: "100%", borderCollapse: "collapse", minWidth: 980, textAlign: "left" }}>
                    <thead>
                      <tr>
                        {data.columns.map((column) => (
                          <th key={column} style={{ padding: "11px 16px", background: "#f8faf8", borderBottom: "1px solid #edf0ed", color: "#6c7a73", fontSize: 11, fontWeight: 650, whiteSpace: "nowrap" }}>{column}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.map((row, rowIndex) => (
                        <tr key={`${sectionSlug}-${data.rowKeys?.[rowIndex] ?? rowIndex}`}>
                          {row.map((cell, cellIndex) => (
                            <td key={`${sectionSlug}-${data.rowKeys?.[rowIndex] ?? rowIndex}-${cellIndex}`} style={{ padding: "13px 16px", borderBottom: rowIndex === data.rows.length - 1 ? 0 : "1px solid #f0f2f0", color: cellIndex === 0 ? "#26352f" : "#687871", fontSize: 12, fontWeight: cellIndex === 0 ? 600 : 400, whiteSpace: "nowrap" }}>{cell}</td>
                          ))}
                        </tr>
                      ))}
                      {data.rows.length === 0 && (
                        <tr>
                          <td colSpan={data.columns.length} style={{ padding: "24px 16px", color: "#87928d", fontSize: 12, textAlign: "center" }}>
                            No records found.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="dashboard-customers-mobile-table">
                  <DashboardSectionInvoiceTable columns={data.columns} rows={data.rows} rowKeys={data.rowKeys} mobileOnly syncMobileScroll />
                </div>
              </>
            ) : sectionSlug === "suppliers" ? (
              <>
                <div className="dashboard-invoice-desktop-table dashboard-suppliers-table-scroll" style={{ overflowX: "auto" }}>
                  <table className="dashboard-suppliers-table" style={{ width: "100%", borderCollapse: "collapse", minWidth: 900, textAlign: "left" }}>
                    <thead>
                      <tr>
                        {data.columns.map((column) => (
                          <th key={column} style={{ padding: "11px 16px", background: "#f8faf8", borderBottom: "1px solid #edf0ed", color: "#6c7a73", fontSize: 11, fontWeight: 650, whiteSpace: "nowrap" }}>{column}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.map((row, rowIndex) => (
                        <tr key={`${sectionSlug}-${data.rowKeys?.[rowIndex] ?? rowIndex}`}>
                          {row.map((cell, cellIndex) => (
                            <td key={`${sectionSlug}-${data.rowKeys?.[rowIndex] ?? rowIndex}-${cellIndex}`} style={{ padding: "13px 16px", borderBottom: rowIndex === data.rows.length - 1 ? 0 : "1px solid #f0f2f0", color: cellIndex === 0 ? "#26352f" : "#687871", fontSize: 12, fontWeight: cellIndex === 0 ? 600 : 400, whiteSpace: "nowrap" }}>{cell}</td>
                          ))}
                        </tr>
                      ))}
                      {data.rows.length === 0 && (
                        <tr>
                          <td colSpan={data.columns.length} style={{ padding: "24px 16px", color: "#87928d", fontSize: 12, textAlign: "center" }}>
                            No records found.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="dashboard-suppliers-mobile-table">
                  <DashboardSectionInvoiceTable columns={data.columns} rows={data.rows} rowKeys={data.rowKeys} mobileOnly syncMobileScroll />
                </div>
              </>
            ) : (
              <div className={sectionSlug === "inventory" ? "dashboard-inventory-table-scroll" : undefined} style={{ overflowX: "auto" }}>
                <table className={sectionSlug === "inventory" ? "dashboard-inventory-table" : undefined} style={{ width: "100%", borderCollapse: "collapse", minWidth: 680, textAlign: "left" }}>
                <thead>
                  <tr>
                    {data.columns.map((column) => (
                      <th key={column} style={{ padding: "11px 16px", background: "#f8faf8", borderBottom: "1px solid #edf0ed", color: "#6c7a73", fontSize: 11, fontWeight: 650, whiteSpace: "nowrap" }}>{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row, rowIndex) => (
                    <tr key={`${sectionSlug}-${rowIndex}`}>
                      {row.map((cell, cellIndex) => (
                        <td key={`${sectionSlug}-${rowIndex}-${cellIndex}`} style={{ padding: "13px 16px", borderBottom: rowIndex === data.rows.length - 1 ? 0 : "1px solid #f0f2f0", color: cellIndex === 0 ? "#26352f" : "#687871", fontSize: 12, fontWeight: cellIndex === 0 ? 600 : 400, whiteSpace: "nowrap" }}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                  {data.rows.length === 0 && (
                    <tr>
                      <td colSpan={data.columns.length} style={{ padding: "24px 16px", color: "#87928d", fontSize: 12, textAlign: "center" }}>
                        No records found.
                      </td>
                    </tr>
                  )}
                </tbody>
                </table>
              </div>
            )}
            {data.listFooter ?? (
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "12px 16px", color: "#87928d", fontSize: 11 }}>
                <span>Showing {data.rows.length} records</span>
                <span>Updated just now</span>
              </div>
            )}
            </section>
          )}
          </SubscriptionActionLock>
        </main>
      </div>
    </div>
  );
}

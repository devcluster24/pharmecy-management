"use client";

import { isValidElement, useState, type ReactNode } from "react";

function getRowIdentity(row: ReactNode[], rowIndex: number) {
  if (isValidElement<{ children?: ReactNode }>(row[0])) {
    return String(row[0].props.children);
  }
  if (typeof row[1] === "string") return row[1];
  return String(row[0] ?? rowIndex);
}

export default function DashboardSectionInvoiceTable({
  columns,
  rows,
  rowKeys,
  mobileOnly = false,
}: {
  columns: string[];
  rows: ReactNode[][];
  rowKeys?: string[];
  mobileOnly?: boolean;
}) {
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  function toggleRow(rowIdentity: string) {
    setExpandedRow((current) => current === rowIdentity ? null : rowIdentity);
  }

  function handleRowKeyDown(event: React.KeyboardEvent<HTMLTableRowElement>, rowIdentity: string) {
    if (!window.matchMedia("(max-width: 767px)").matches
      || (event.target instanceof Element && event.target.closest("button"))
      || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    toggleRow(rowIdentity);
  }

  function handleRowClick(event: React.MouseEvent<HTMLTableRowElement>, rowIdentity: string) {
    if (!window.matchMedia("(max-width: 767px)").matches
      || (event.target instanceof Element && event.target.closest("button"))) return;
    toggleRow(rowIdentity);
  }

  return (
    <div className={`dashboard-invoice-table-container${mobileOnly ? " dashboard-invoice-mobile-only" : ""}`}>
      {!mobileOnly && (
        <div className="dashboard-invoice-desktop-table dashboard-invoice-table-scroll" style={{ overflowX: "auto" }}>
          <table className="dashboard-invoice-table" style={{ width: "100%", borderCollapse: "collapse", minWidth: 680, textAlign: "left" }}>
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column} style={{ padding: "11px 16px", background: "#f8faf8", borderBottom: "1px solid #edf0ed", color: "#6c7a73", fontSize: 11, fontWeight: 650, whiteSpace: "nowrap" }}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`invoice-${getRowIdentity(row, rowIndex)}`}>
                  {row.map((cell, cellIndex) => (
                    <td key={`${getRowIdentity(row, rowIndex)}-${cellIndex}`} style={{ padding: "13px 16px", borderBottom: rowIndex === rows.length - 1 ? 0 : "1px solid #f0f2f0", color: cellIndex === 0 ? "#26352f" : "#687871", fontSize: 12, fontWeight: cellIndex === 0 ? 600 : 400, whiteSpace: "nowrap" }}>{cell}</td>
                  ))}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={columns.length} style={{ padding: "24px 16px", color: "#87928d", fontSize: 12, textAlign: "center" }}>
                    No records found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div
        className="dashboard-invoice-mobile-table"
        style={{
          "--dashboard-invoice-mobile-table-width": `calc(100vw - 50px + ${Math.max(0, columns.length - 4) * 80}px)`,
        } as React.CSSProperties}
      >
        <div className="dashboard-invoice-table-scroll" style={{ overflowX: "auto" }}>
          <table className="dashboard-invoice-table" style={{ width: "100%", borderCollapse: "collapse", minWidth: 680, textAlign: "left" }}>
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column} style={{ padding: "11px 16px", background: "#f8faf8", borderBottom: "1px solid #edf0ed", color: "#6c7a73", fontSize: 11, fontWeight: 650, whiteSpace: "nowrap" }}>{column}</th>
                ))}
              </tr>
            </thead>
          </table>
        </div>
        {rows.length === 0 ? (
          <div className="dashboard-invoice-mobile-empty">No records found.</div>
        ) : rows.map((row, rowIndex) => {
          const rowIdentity = rowKeys?.[rowIndex] ?? getRowIdentity(row, rowIndex);
          const isExpanded = expandedRow === rowIdentity;

          return (
            <div className="dashboard-invoice-mobile-record" key={`mobile-invoice-${rowIdentity}`}>
              <div className="dashboard-invoice-table-scroll" style={{ overflowX: "auto" }}>
                <table className="dashboard-invoice-table" style={{ width: "100%", borderCollapse: "collapse", minWidth: 680, textAlign: "left" }}>
                  <tbody>
                    <tr
                      className={`dashboard-invoice-row${isExpanded ? " is-expanded" : ""}`}
                      tabIndex={0}
                      aria-expanded={isExpanded}
                      onClick={(event) => handleRowClick(event, rowIdentity)}
                      onKeyDown={(event) => handleRowKeyDown(event, rowIdentity)}
                    >
                      {row.map((cell, cellIndex) => (
                        <td key={`${rowIdentity}-${cellIndex}`} style={{ padding: "13px 16px", borderBottom: rowIndex === rows.length - 1 ? 0 : "1px solid #f0f2f0", color: cellIndex === 0 ? "#26352f" : "#687871", fontSize: 12, fontWeight: cellIndex === 0 ? 600 : 400, whiteSpace: "nowrap" }}>{cell}</td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
              {isExpanded && (
                <div className="dashboard-invoice-expanded-details">
                  {row.map((cell, cellIndex) => (
                    <div className="dashboard-invoice-expanded-value" key={`${rowIdentity}-detail-${cellIndex}`}>
                      <span>{columns[cellIndex]}</span>
                      <strong>{cell}</strong>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

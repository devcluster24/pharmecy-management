"use client";

import { useState, type FocusEvent } from "react";
import {
  useDashboardLanguage,
  type DashboardLanguage,
} from "./DashboardLanguageProvider";

const languageOptions: { value: DashboardLanguage; label: string }[] = [
  { value: "en", label: "English" },
  { value: "bn", label: "বাংলা" },
];

export default function DashboardLanguageMenu() {
  const { language, setLanguage } = useDashboardLanguage();
  const [isOpen, setIsOpen] = useState(false);

  function closeOnFocusLeave(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsOpen(false);
    }
  }

  return (
    <div
      className="dashboard-language-menu"
      onBlur={closeOnFocusLeave}
      style={{ position: "relative", flex: "0 0 auto" }}
    >
      <button
        type="button"
        className="dashboard-language-trigger"
        aria-label={language === "bn" ? "ভাষা নির্বাচন" : "Select language"}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        style={{
          minHeight: 34,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          padding: "0 10px",
          border: "1px solid #dce6df",
          borderRadius: 8,
          background: "#fff",
          color: "#40564a",
          fontSize: 12,
          fontWeight: 650,
          whiteSpace: "nowrap",
          cursor: "pointer",
        }}
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" width="15" height="15" fill="none">
          <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.4" />
          <path d="M2.9 10h14.2M10 2.75c1.75 1.9 2.6 4.3 2.6 7.25s-.85 5.35-2.6 7.25C8.25 15.35 7.4 12.95 7.4 10s.85-5.35 2.6-7.25Z" stroke="currentColor" strokeWidth="1.2" />
        </svg>
        <span className="dashboard-language-trigger-label">
          {language === "bn" ? "ভাষা" : "Language"}
        </span>
        <span className="dashboard-language-trigger-caret" aria-hidden="true" style={{ fontSize: 10, lineHeight: 1 }}>▾</span>
      </button>

      {isOpen && (
        <div
          className="dashboard-language-options"
          role="menu"
          aria-label={language === "bn" ? "ভাষা নির্বাচন" : "Choose language"}
          style={{
            position: "absolute",
            top: "calc(100% + 7px)",
            right: 0,
            zIndex: 40,
            minWidth: 132,
            padding: 5,
            border: "1px solid #e1e8e3",
            borderRadius: 8,
            background: "#fff",
            boxShadow: "0 8px 24px rgba(22, 42, 31, 0.12)",
          }}
        >
          {languageOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={language === option.value}
              onClick={() => {
                setLanguage(option.value);
                setIsOpen(false);
              }}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "9px 10px",
                border: 0,
                borderRadius: 5,
                background: language === option.value ? "#edf6f0" : "transparent",
                color: language === option.value ? "#17684f" : "#26352f",
                textAlign: "left",
                fontSize: 12,
                fontWeight: language === option.value ? 700 : 550,
                cursor: "pointer",
              }}
            >
              {option.label}
              {language === option.value ? <span aria-hidden="true">✓</span> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

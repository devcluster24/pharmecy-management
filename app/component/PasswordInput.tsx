"use client";

import { useState, type InputHTMLAttributes } from "react";

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

export default function PasswordInput({ style, ...props }: PasswordInputProps) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <input
        {...props}
        type={isVisible ? "text" : "password"}
        style={{
          ...style,
          paddingRight: style?.paddingRight ?? 42,
        }}
      />
      <button
        type="button"
        aria-label={isVisible ? "Hide password" : "Show password"}
        aria-pressed={isVisible}
        onClick={() => setIsVisible((visible) => !visible)}
        style={{
          position: "absolute",
          top: "50%",
          right: 9,
          display: "grid",
          width: 28,
          height: 28,
          padding: 0,
          placeItems: "center",
          transform: "translateY(-50%)",
          border: 0,
          borderRadius: 6,
          background: "transparent",
          color: "#687871",
          cursor: "pointer",
        }}
      >
        <svg
          aria-hidden="true"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {isVisible ? (
            <>
              <path d="M3 3l18 18" />
              <path d="M10.6 10.6a2 2 0 002.8 2.8" />
              <path d="M9.9 5.2A10.8 10.8 0 0112 5c5.2 0 8.8 4.4 10 7-.4.9-1.1 2-2.1 3" />
              <path d="M6.2 6.2C3.9 7.5 2.5 9.5 2 12c1.2 2.6 4.8 7 10 7 1.1 0 2.1-.2 3.1-.6" />
            </>
          ) : (
            <>
              <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
              <circle cx="12" cy="12" r="3" />
            </>
          )}
        </svg>
      </button>
    </div>
  );
}

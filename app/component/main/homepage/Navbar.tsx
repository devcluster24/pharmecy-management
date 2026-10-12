"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import styles from "./Navbar.module.css";

const navLinks = [
  { href: "/features", label: "Features" },
  { href: "/pricing", label: "Pricing" },
  { href: "/faq", label: "FAQ" },
  { href: "/contact", label: "Contact" },
];

export default function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className={styles.header}>
      <div className={styles.container}>
        <Link
          href="/"
          aria-label="Pharmacy Cluster home"
          className={styles.brand}
        >
          <Image
            src="/pharmacy-icon.png"
            alt=""
            width={36}
            height={36}
            aria-hidden="true"
            className={styles.logo}
          />
          <span className={styles.brandName}>
            Pharmacy<span className={styles.brandAccent}> Cluster</span>
          </span>
        </Link>

        <nav className={styles.desktopNav} aria-label="Main navigation">
          {navLinks.map(({ href, label }) => (
            <Link key={href} href={href} className={styles.navLink}>
              {label}
            </Link>
          ))}
        </nav>

        <div className={styles.desktopActions}>
          <Link href="/login" className={styles.loginButton}>
            Login
          </Link>
          <Link href="/register" className={styles.startButton}>
            Get Started <span aria-hidden="true">→</span>
          </Link>
        </div>

        <button
          type="button"
          className={styles.menuButton}
          aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
          aria-expanded={menuOpen}
          aria-controls="mobile-navigation"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span className={menuOpen ? styles.menuIconOpen : styles.menuIcon}>
            <span />
            <span />
            <span />
          </span>
        </button>

        {menuOpen && (
          <div className={styles.mobileMenu} id="mobile-navigation">
            <nav className={styles.mobileNav} aria-label="Mobile navigation">
              {navLinks.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  className={styles.mobileNavLink}
                  onClick={() => setMenuOpen(false)}
                >
                  {label}
                </Link>
              ))}
            </nav>
            <div className={styles.mobileActions}>
              <Link
                href="/login"
                className={styles.loginButton}
                onClick={() => setMenuOpen(false)}
              >
                Login
              </Link>
              <Link
                href="/register"
                className={styles.startButton}
                onClick={() => setMenuOpen(false)}
              >
                Get Started <span aria-hidden="true">→</span>
              </Link>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}

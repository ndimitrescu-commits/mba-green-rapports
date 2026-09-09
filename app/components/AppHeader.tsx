"use client";

/**
 * Barre de navigation partagée — logo MBA Green + liens vers les 4 pages de
 * l'outil, toujours affichée en haut (le lien actif en gras). Utilisée sur
 * les 4 pages (/, /preview, /prevision, /rfa) pour pouvoir naviguer entre
 * elles directement, sans repasser par l'accueil (remarque Nicolas,
 * 09/09/2026).
 */
import { theme, microLabel, headerBar, navLink, navLinkMuted } from "@/lib/theme";

const NAV_ITEMS: { href: string; label: string }[] = [
  { href: "/", label: "Générer" },
  { href: "/preview", label: "Aperçu & édition" },
  { href: "/prevision", label: "Prévisionnel" },
  { href: "/rfa", label: "RFAs" },
];

export default function AppHeader({ active }: { active: string }) {
  return (
    <div style={headerBar}>
      <a href="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-mba-green.png" alt="MBA Green" style={{ height: 26, width: "auto" }} />
        <span style={{ ...microLabel, marginLeft: 4 }}>RAPPORTS</span>
      </a>
      <nav style={{ display: "flex", gap: 24, alignItems: "center" }}>
        {NAV_ITEMS.map((item) => (
          <a
            key={item.href}
            href={item.href}
            style={item.href === active ? { ...navLink, fontWeight: 600 } : navLinkMuted}
          >
            {item.label}
          </a>
        ))}
      </nav>
    </div>
  );
}

"use client";

/**
 * Barre de navigation partagée — remplace l'ancien bandeau simple (4 liens)
 * par le menu unifié des autres outils MBA Green (dashboard, GEODIS, GLS,
 * demand-planning) : logo cliquable vers l'intranet, menu principal avec
 * sous-menus déroulants (Logistique / Approvisionnement / Commandes /
 * Autres), et une bande secondaire propre à cet outil avec ses 4 pages
 * (demande Nicolas 10/09/2026 : « revoir le design de cet outil ... pour
 * coller à ce qu'on vient de faire pour GLS, Geodis et Demand planning »).
 * Pas de Tailwind dans ce projet : styles inline React, pas de classes.
 * "Autres" est actif ici puisque Rapports mensuels en fait partie.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { NavDropdown } from "./NavDropdown";

const MENU_GROUPS = [
  {
    label: "Logistique",
    items: [
      { label: "GEODIS", href: "https://suivi-livraisons-geodis.vercel.app/" },
      { label: "GLS", href: "https://gls-suivi.vercel.app/" },
    ],
  },
  {
    label: "Approvisionnement",
    items: [
      { label: "Demand planning", href: "https://mba-green-demand-planning.vercel.app/conso" },
      { label: "Approvisionnement", href: "https://mba-green-procurement.vercel.app/rfq" },
    ],
  },
  {
    label: "Commandes",
    items: [
      { label: "CSV Generator", href: "https://mbagreen-app-production.up.railway.app/login" },
      { label: "Portail B2B", href: "https://mba-green-portal.vercel.app/" },
    ],
  },
  {
    label: "Autres",
    items: [
      { label: "Rapports mensuels", href: "https://mba-green-rapports.vercel.app/" },
      { label: "Datasheet Database", href: "https://mba-green-fiches-produit.vercel.app/repertoire" },
    ],
  },
];

const NAV_ITEMS: { href: string; label: string }[] = [
  { href: "/", label: "Générer" },
  { href: "/preview", label: "Aperçu & édition" },
  { href: "/prevision", label: "Prévisionnel" },
  { href: "/rfa", label: "RFAs" },
];

function SignOutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    setLoading(true);
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={loading}
      style={{
        borderRadius: 9999,
        border: "1px solid rgba(255,255,255,0.25)",
        padding: "6px 12px",
        fontSize: 12,
        fontWeight: 500,
        fontFamily: "var(--font-sans)",
        color: "rgba(255,255,255,0.85)",
        background: "transparent",
        cursor: loading ? "not-allowed" : "pointer",
      }}
    >
      Déconnexion
    </button>
  );
}

export default function AppHeader({ active }: { active: string }) {
  return (
    <header style={{ borderBottom: "4px solid #14140F", background: "#101F17" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 24,
          height: 76,
          maxWidth: 1440,
          margin: "0 auto",
          padding: "0 32px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 36 }}>
          <a
            href="https://intranet.mbagreen.net"
            style={{ fontFamily: "var(--font-logo)", fontSize: 20, color: "#F5EFE2", textDecoration: "none" }}
          >
            MBA<span style={{ color: "#C6F24E" }}>GREEN™</span>
          </a>
          <nav style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <a
              href="https://intranet.mbagreen.net"
              style={{
                borderRadius: 9999,
                padding: "8px 14px",
                fontSize: 14,
                fontWeight: 600,
                fontFamily: "var(--font-sans)",
                color: "rgba(255,255,255,0.85)",
                textDecoration: "none",
              }}
            >
              Vue d&apos;ensemble
            </a>
            {MENU_GROUPS.map((group) => (
              <NavDropdown key={group.label} label={group.label} items={group.items} active={group.label === "Autres"} />
            ))}
          </nav>
        </div>
        <SignOutButton />
      </div>

      <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", background: "#16281C", padding: "0 16px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            height: 44,
            maxWidth: 1440,
            margin: "0 auto",
            overflowX: "auto",
          }}
        >
          <span
            style={{
              whiteSpace: "nowrap",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.05em",
              color: "#C6F24E",
              fontFamily: "var(--font-sans)",
            }}
          >
            RAPPORTS
          </span>
          <nav style={{ display: "flex", gap: 4 }}>
            {NAV_ITEMS.map((item) => {
              const isActive = item.href === active;
              return (
                <a
                  key={item.href}
                  href={item.href}
                  style={{
                    whiteSpace: "nowrap",
                    borderRadius: 9999,
                    padding: "6px 12px",
                    fontSize: 12,
                    fontWeight: 600,
                    fontFamily: "var(--font-sans)",
                    textDecoration: "none",
                    background: isActive ? "rgba(255,255,255,0.15)" : "transparent",
                    color: isActive ? "#fff" : "rgba(255,255,255,0.7)",
                  }}
                >
                  {item.label}
                </a>
              );
            })}
          </nav>
        </div>
      </div>
    </header>
  );
}

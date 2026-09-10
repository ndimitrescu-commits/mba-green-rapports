"use client";

/**
 * Sous-menu du header — repris à l'identique des autres outils MBA Green
 * (GEODIS, GLS, demand-planning, dashboard) pour un menu de navigation
 * unifié (demande Nicolas 10/09/2026). Pas de Tailwind dans ce projet :
 * même comportement (clic pour ouvrir, ferme au clic extérieur / Échap /
 * sélection d'un lien), mais en styles inline React plutôt qu'en classes.
 *
 * Toujours des liens externes (autres outils déployés séparément) :
 * ouverture en nouvel onglet pour garder l'outil courant.
 *
 * `active` force le style "sélectionné" même fermé — utilisé ici pour
 * "Autres", puisque cet outil (Rapports mensuels) en fait partie.
 */
import { useEffect, useRef, useState } from "react";

export interface NavDropdownItem {
  label: string;
  href: string;
}

export function NavDropdown({
  label,
  items,
  active = false,
}: {
  label: string;
  items: NavDropdownItem[];
  active?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const highlighted = open || active;

  return (
    <div style={{ position: "relative" }} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          borderRadius: 9999,
          padding: "8px 14px",
          fontSize: 14,
          fontWeight: 600,
          fontFamily: "var(--font-sans)",
          border: "none",
          cursor: "pointer",
          background: highlighted ? "#D6F569" : "transparent",
          color: highlighted ? "#14140F" : "rgba(255,255,255,0.85)",
        }}
      >
        {label}
        <svg
          width="10"
          height="6"
          viewBox="0 0 10 6"
          fill="none"
          style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform 0.15s" }}
        >
          <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: "calc(100% + 10px)",
            zIndex: 30,
            minWidth: 220,
            borderRadius: 10,
            border: "1px solid #E7E7E0",
            background: "#fff",
            padding: 6,
            boxShadow: "0 4px 16px rgba(20,20,15,0.08)",
          }}
        >
          {items.map((item) => (
            <a
              key={item.href}
              href={item.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                borderRadius: 8,
                padding: "10px 14px",
                fontSize: 14,
                fontWeight: 600,
                fontFamily: "var(--font-sans)",
                color: "#14140F",
                textDecoration: "none",
              }}
            >
              {item.label}
              <span style={{ color: "#8C8A7E" }}>↗</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

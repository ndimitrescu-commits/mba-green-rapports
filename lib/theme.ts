/**
 * lib/theme.ts
 * ============
 * Design system partagé de l'outil MBA Green Rapports — première étape
 * d'homogénéisation avec les autres outils internes (demande de Nicolas,
 * 09/09/2026, sur le modèle visuel de l'outil Demand Planning : fond crème,
 * titres serif, labels petites capitales monospace, boutons noirs pleins).
 * Pas de framework CSS dans ce projet (styles inline React) : ce fichier
 * centralise les tokens + quelques générateurs de style réutilisables plutôt
 * que de les dupliquer dans chaque page.
 */
import type { CSSProperties } from "react";

export const theme = {
  bg: "#F5F1E8",
  card: "#FFFFFF",
  border: "#DAD4C2",
  borderStrong: "#1B1B16",
  ink: "#1B1B16",
  inkMuted: "#6B6A5F",
  green: "#1F3D2B",
  bad: "#C1440E",
  good: "#2E7D4F",
  fontSerif: "var(--font-serif, Georgia, serif)",
  fontMono: "var(--font-mono, 'IBM Plex Mono', monospace)",
  fontSans: "var(--font-sans, Arial, sans-serif)",
};

/** Petit label en capitales, espacé, monospace — ex. "CLIENT (MARQUE)". */
export const microLabel: CSSProperties = {
  fontFamily: theme.fontMono,
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: theme.inkMuted,
};

export const pageShell: CSSProperties = {
  minHeight: "100vh",
  background: theme.bg,
  color: theme.ink,
  fontFamily: theme.fontSans,
};

export const headerBar: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "20px 40px",
  borderBottom: `1px solid ${theme.border}`,
  flexWrap: "wrap",
  gap: 16,
};

export const navLink: CSSProperties = {
  color: theme.ink,
  fontFamily: theme.fontSans,
  fontSize: 15,
  textDecoration: "none",
};

export const navLinkMuted: CSSProperties = {
  ...navLink,
  color: theme.inkMuted,
};

export const card: CSSProperties = {
  background: theme.card,
  border: `1px solid ${theme.border}`,
  borderRadius: 14,
};

export const input: CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 8,
  border: `1px solid ${theme.border}`,
  background: theme.card,
  fontSize: 14,
  color: theme.ink,
  fontFamily: theme.fontSans,
};

export function buttonPrimary(disabled?: boolean): CSSProperties {
  return {
    background: theme.ink,
    color: "#fff",
    border: "none",
    padding: "12px 22px",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    fontFamily: theme.fontSans,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
}

export function buttonSecondary(disabled?: boolean): CSSProperties {
  return {
    background: theme.card,
    color: theme.ink,
    border: `1px solid ${theme.borderStrong}`,
    padding: "11px 20px",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    fontFamily: theme.fontSans,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
}

/** Petit rond coloré (bon/mauvais) utilisé devant un pourcentage d'écart. */
export function dot(color: string): CSSProperties {
  return {
    display: "inline-block",
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: color,
    marginRight: 6,
  };
}

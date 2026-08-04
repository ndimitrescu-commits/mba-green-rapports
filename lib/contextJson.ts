/**
 * lib/contextJson.ts
 * ==================
 * Sérialisation JSON du ReportContext pour l'aller-retour aperçu/édition :
 * l'API /api/context renvoie le contexte au navigateur, l'utilisateur modifie
 * les valeurs dans l'interface, puis /api/generate reçoit le contexte
 * (éventuellement retouché) et rend le PDF sans refaire la collecte.
 *
 * Particularité : ReportContext contient des Set (restaurant_names) que JSON
 * ne connaît pas — ils sont encodés en `{ "__set": [...] }` et restaurés au
 * parsing. Côté navigateur, l'éditeur manipule la forme encodée telle quelle.
 */
import type { ReportContext } from "./types";

export function contextToJson(ctx: ReportContext): string {
  return JSON.stringify(ctx, (_k, v) => (v instanceof Set ? { __set: Array.from(v) } : v));
}

export function contextFromJson(json: string): ReportContext {
  return JSON.parse(json, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v) && Array.isArray((v as { __set?: unknown[] }).__set)
      ? new Set((v as { __set: unknown[] }).__set)
      : v
  ) as ReportContext;
}

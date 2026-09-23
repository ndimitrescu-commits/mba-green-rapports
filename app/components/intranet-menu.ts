// ─────────────────────────────────────────────────────────────────────────────
// MENU INTRANET MBA GREEN — SOURCE UNIQUE
// Ne pas modifier ce fichier dans un outil : modifier
//   Projects/_intranet-nav/intranet-menu.ts
// puis lancer  Projects/_intranet-nav/sync-intranet-nav.sh  qui le recopie
// dans tous les outils (dashboard, GEODIS, GLS, shipments, planning, RFQ,
// rapports, fiches). Chaque outil reste un déploiement indépendant.
// ─────────────────────────────────────────────────────────────────────────────

export interface IntranetMenuItem {
  label: string;
  href: string;
}

export interface IntranetMenuGroup {
  label: string;
  items: IntranetMenuItem[];
}

export const OVERVIEW_HREF = "https://intranet.mbagreen.net/";

export const MENU_GROUPS: IntranetMenuGroup[] = [
  {
    label: "Logistique",
    items: [
      { label: "GEODIS", href: "https://geodis.intranet.mbagreen.net/" },
      { label: "GLS", href: "https://gls.intranet.mbagreen.net/" },
      { label: "Inbound Shipments", href: "https://shipments.intranet.mbagreen.net/" },
    ],
  },
  {
    label: "Approvisionnement",
    items: [
      { label: "Demand planning", href: "https://planning.intranet.mbagreen.net/en-cours" },
      { label: "RFQ", href: "https://rfq.intranet.mbagreen.net/dashboard" },
    ],
  },
  {
    label: "Commandes",
    items: [
      { label: "CSV Generator", href: "https://po.intranet.mbagreen.net/login" },
      { label: "Portail B2B", href: "https://portal.intranet.mbagreen.net/" },
    ],
  },
  {
    label: "Autres",
    items: [
      { label: "Rapports mensuels", href: "https://rapports.intranet.mbagreen.net/" },
      { label: "Datasheet Database", href: "https://fiches.intranet.mbagreen.net/repertoire" },
    ],
  },
];

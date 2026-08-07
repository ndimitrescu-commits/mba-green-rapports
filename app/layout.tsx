import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Rapport Mensuel Client",
  description: "Génération de rapports mensuels clients",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}

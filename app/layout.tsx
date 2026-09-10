import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "MBA Green — Rapports",
  description: "Génération de rapports mensuels clients",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&family=IBM+Plex+Mono:wght@400;500;600&family=Archivo+Black&display=swap"
          rel="stylesheet"
        />
        <style>{`
          :root {
            --font-serif: 'Newsreader', Georgia, 'Times New Roman', serif;
            --font-mono: 'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace;
            --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
            --font-logo: 'Archivo Black', sans-serif;
            --mba-bg: #FBF9F5;
            --mba-ink: #14140F;
            --mba-ink-muted: #4B4A3F;
            --mba-green: #16A34A;
            --mba-border: #E7E7E0;
            --mba-card: #FFFFFF;
            --mba-bad: #E8623D;
            --mba-good: #16A34A;
          }
          * { box-sizing: border-box; }
          html, body { margin: 0; padding: 0; }
          body { background: var(--mba-bg); font-family: var(--font-sans); color: var(--mba-ink); }
        `}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}

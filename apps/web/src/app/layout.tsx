import { type Metadata, type Viewport } from "next";
import { type ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "corpus-lens",
  description: "Semantic search and grounded answers over an internal documentation corpus.",
};

export const viewport: Viewport = {
  // The theme colour follows the same system preference the CSS tokens do, so the browser
  // chrome on mobile matches the page instead of framing a dark app in white.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fcfcfd" },
    { media: "(prefers-color-scheme: dark)", color: "#14161c" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}

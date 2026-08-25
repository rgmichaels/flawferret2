import "./styles.css";
import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Source_Serif_4, Space_Grotesk } from "next/font/google";
import type { ReactNode } from "react";

const spaceGrotesk = Space_Grotesk({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "700"],
});

// Only the Framework Builder create flow uses this face today: the `.framework-builder-page` block
// in styles.css re-points --font-display at --font-serif-display for that subtree, so nothing else
// resolves to it. Declared here because next/font must be called from a module the Next compiler
// processes, and `preload: false` keeps it off the critical path of the pages that never use it.
const sourceSerif4 = Source_Serif_4({
  display: "swap",
  preload: false,
  subsets: ["latin"],
  variable: "--font-serif-display",
  weight: ["400", "500", "600"],
});

const ibmPlexSans = IBM_Plex_Sans({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "600"],
});

const ibmPlexMono = IBM_Plex_Mono({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "600"],
});

export const metadata: Metadata = {
  title: "FlawFerret2",
  description: "AI-powered QA orchestration foundation.",
  icons: {
    icon: "/flawferret2-favicon-32.png",
    shortcut: "/flawferret2-favicon-32.png",
    apple: "/flawferret2-apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${ibmPlexSans.variable} ${ibmPlexMono.variable} ${sourceSerif4.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}

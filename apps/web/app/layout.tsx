import "./styles.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";

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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

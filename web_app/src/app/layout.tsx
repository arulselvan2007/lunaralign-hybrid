import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "LunarAlign-Hybrid: Google Maps for the Moon (Chandrayaan-2 TMC-2)",
  description: "3D Interactive Planetary Registration & Multi-Temporal Surface Intelligence",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
      </head>
      <body className="antialiased bg-lunar-950 text-slate-100 overflow-hidden">
        {children}
      </body>
    </html>
  );
}

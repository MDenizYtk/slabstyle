import type { Metadata, Viewport } from "next";
import { Archivo_Black, Inter } from "next/font/google";
import "./globals.css";

const display = Archivo_Black({ variable: "--font-archivo-black", weight: "400", subsets: ["latin", "latin-ext"] });
const sans = Inter({ variable: "--font-inter", subsets: ["latin", "latin-ext"] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:4920"),
  title: { default: "SLAB STYLE Car Care", template: "%s | SLAB STYLE Car Care" },
  description: "Profesyonel oto bakım ve detailing ürünleri: yıkama, cila, seramik kaplama, iç temizlik ve ekipman.",
};

export const viewport: Viewport = { themeColor: "#0a0a0b" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="tr" className={`${display.variable} ${sans.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}

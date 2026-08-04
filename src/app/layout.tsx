import type { Metadata } from "next";
import { Fraunces, Nunito_Sans } from "next/font/google";
import "./globals.css";

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display-loaded",
  display: "swap",
});

const body = Nunito_Sans({
  subsets: ["latin"],
  variable: "--font-body-loaded",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Surgical Report Grading",
  description: "Oral & maxillofacial AI surgical report grading platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className={`${display.variable} ${body.variable}`}>
      <body
        style={{
          // Wire next/font CSS variables into the design tokens in globals.css
          ["--font-display" as string]: "var(--font-display-loaded), Fraunces, serif",
          ["--font-body" as string]: "var(--font-body-loaded), 'Nunito Sans', sans-serif",
        }}
      >
        {children}
      </body>
    </html>
  );
}

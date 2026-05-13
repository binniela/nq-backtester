import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const alliance = localFont({
  src: [
    { path: "./fonts/AllianceNo2-Light.otf",     weight: "300", style: "normal" },
    { path: "./fonts/AllianceNo2-Regular.otf",   weight: "400", style: "normal" },
    { path: "./fonts/AllianceNo2-SemiBold.otf",  weight: "600", style: "normal" },
    { path: "./fonts/AllianceNo2-Bold.otf",      weight: "700", style: "normal" },
    { path: "./fonts/AllianceNo2-ExtraBold.otf", weight: "800", style: "normal" },
  ],
  variable: "--font-alliance",
});

export const metadata: Metadata = {
  title: "NQ Replay Lab",
  description: "Local-first E-mini Nasdaq-100 futures replay and backtesting.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${alliance.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}

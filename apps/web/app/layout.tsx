import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ToolAiMe Web",
  description: "Typed web boundary for the ToolAiMe studio.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

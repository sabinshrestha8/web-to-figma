import type { ReactNode } from "react";
import "./globals.css";

export const metadata = { title: "Web to Figma" };

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-50 text-slate-900">{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@stackoverflow/stacks/dist/css/stacks.css";
import "../styles/app.css";

export const metadata: Metadata = {
  title: "Stack API Utilities",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

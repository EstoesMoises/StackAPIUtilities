import type { Metadata } from "next";
import type { ReactNode } from "react";
import "../styles/tailwind.css";
import "@stackoverflow/stacks/dist/css/stacks.css";
import "../styles/app.css";

export const metadata: Metadata = {
  title: "Stack API Utilities",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

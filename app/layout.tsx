export const metadata = { title: "PDF Mapping App" };

import "./globals.css";
import React from "react";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body className="min-h-screen">
        {children}
      </body>
    </html>
  );
}


import type { Metadata } from "next";
import "./globals.css";
import { PrivyProviderWrapper } from "./PrivyProviderWrapper";

export const metadata: Metadata = {
  title: "Chat Evaluator",
  description: "Evaluate chat scenarios against the protocol API",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <PrivyProviderWrapper>{children}</PrivyProviderWrapper>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { TRPCProvider } from "@/components/providers/trpc-provider";
import { ThemeProvider } from "@/components/providers/theme-provider";
import "./globals.css";

export const dynamic = "force-dynamic";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "RPG Story Generator",
  description:
    "Create and play narrative RPG campaigns powered by AI. Build characters, shape worlds, and let the story unfold.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark ${inter.variable}`} suppressHydrationWarning>
      <body className="font-sans min-h-screen">
        <TRPCProvider>
          <ThemeProvider>{children}</ThemeProvider>
        </TRPCProvider>
      </body>
    </html>
  );
}

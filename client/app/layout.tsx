import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "The Golden Fork — AI Reservation Assistant",
  description:
    "Voice AI reservation assistant for The Golden Fork restaurant — powered by colocated inference on EKS",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}
    >
      <body className="h-full flex flex-col bg-background text-foreground text-sm overflow-x-hidden lg:overflow-hidden">
        <div className="flex-1 w-full max-w-4xl mx-auto px-4 sm:px-6">
          {children}
        </div>
      </body>
    </html>
  );
}

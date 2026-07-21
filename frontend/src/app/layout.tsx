import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import { SITE_URL } from "@/lib/site";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { CreditsProvider } from "@/lib/credits-context";
import { ConsentProvider } from "@/lib/consent-context";
import GlobalAuthModal from "@/components/GlobalAuthModal";
import FloatingFeedback from "@/components/FloatingFeedback";
import AnalyticsTracker from "@/components/AnalyticsTracker";
import InstallExtensionModal from "@/components/InstallExtensionModal";
import GrantPermissionModal from "@/components/GrantPermissionModal";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "vietnamese"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  // Plain string (not a template): pages that set their own title already
  // include "Copo" (privacy/terms/j), so a "%s | Copo" template would double it.
  title: "Copo | Trợ lý tìm việc & tối ưu CV",
  description: "Tải CV lên, để AI tìm việc phù hợp, chấm điểm độ khớp và gợi ý tối ưu CV. Cam kết không bịa nội dung.",
  applicationName: "Copo",
  openGraph: {
    type: "website",
    siteName: "Copo",
    locale: "vi_VN",
    url: SITE_URL,
    title: "Copo | Trợ lý tìm việc & tối ưu CV",
    description: "Tải CV lên, để AI tìm việc phù hợp, chấm điểm độ khớp và gợi ý tối ưu CV. Cam kết không bịa nội dung.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Copo | Trợ lý tìm việc & tối ưu CV",
    description: "Tải CV lên, để AI tìm việc phù hợp, chấm điểm độ khớp và gợi ý tối ưu CV.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <head>
        {/* Set theme before paint to avoid a flash. Default is light;
            only flip to dark when the user previously chose it. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('jobfit-theme');if(t==='dark'){document.documentElement.setAttribute('data-theme','dark');}}catch(e){}})();`,
          }}
        />
        {/* Editorial "manifesto" type system (Copo brand). Used by the landing
            front door today; being rolled across the app. Be Vietnam Pro carries
            the Vietnamese diacritics the display face may not cover. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,800&family=Be+Vietnam+Pro:ital,wght@0,400;0,500;0,600;1,400&family=Lora:ital,wght@0,400;0,500;1,400;1,500&family=IBM+Plex+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body
        className={`${inter.variable} ${geistMono.variable} antialiased`}
      >
        <AuthProvider>
          <CreditsProvider>
            <ConsentProvider>
              {children}
              <GlobalAuthModal />
              <FloatingFeedback />
              <AnalyticsTracker />
              <InstallExtensionModal />
              <GrantPermissionModal />
            </ConsentProvider>
          </CreditsProvider>
        </AuthProvider>
      </body>
    </html>
  );
}

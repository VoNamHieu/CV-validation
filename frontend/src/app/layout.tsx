import type { Metadata } from "next";
import { Inter, Geist_Mono, Bricolage_Grotesque, Be_Vietnam_Pro, Lora, IBM_Plex_Mono } from "next/font/google";
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

// Editorial "manifesto" type system (Copo brand), now self-hosted via next/font
// instead of a render-blocking Google Fonts <link> — faster LCP, no layout shift.
const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin", "vietnamese"],
  display: "swap",
});
const beVietnam = Be_Vietnam_Pro({
  variable: "--font-be-vietnam",
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600"],
  display: "swap",
});
const lora = Lora({
  variable: "--font-lora",
  subsets: ["latin", "vietnamese"],
  style: ["normal", "italic"],
  display: "swap",
});
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  // Plain string (not a template): pages that set their own title already
  // include "Copo" (privacy/terms/j), so a "%s | Copo" template would double it.
  // The description spells out the full loop incl. auto-apply — it's the field
  // AI answer engines extract most, and auto-apply is the key differentiator.
  title: "Copo | Tìm việc, tối ưu CV & tự động ứng tuyển bằng AI",
  description: "Copo là trợ lý AI lo trọn khâu xin việc: tải CV lên, AI tìm việc khớp từ trang tuyển dụng chính thức, tối ưu CV theo từng vị trí (không bịa nội dung), rồi tự động điền form và nộp hồ sơ giúp bạn.",
  applicationName: "Copo",
  openGraph: {
    type: "website",
    siteName: "Copo",
    locale: "vi_VN",
    url: SITE_URL,
    title: "Copo | Tìm việc, tối ưu CV & tự động ứng tuyển bằng AI",
    description: "Trợ lý AI lo trọn khâu xin việc: tìm việc khớp từ trang tuyển dụng chính thức, tối ưu CV không bịa nội dung, rồi tự động điền form và nộp hồ sơ giúp bạn.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Copo | Tìm việc, tối ưu CV & tự động ứng tuyển bằng AI",
    description: "Trợ lý AI lo trọn khâu xin việc: tìm việc khớp, tối ưu CV không bịa nội dung, và tự động nộp hồ sơ giúp bạn.",
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
      </head>
      <body
        className={`${inter.variable} ${geistMono.variable} ${bricolage.variable} ${beVietnam.variable} ${lora.variable} ${plexMono.variable} antialiased`}
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

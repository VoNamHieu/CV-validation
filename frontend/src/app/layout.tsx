import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { CreditsProvider } from "@/lib/credits-context";
import { ConsentProvider } from "@/lib/consent-context";
import GlobalAuthModal from "@/components/GlobalAuthModal";
import FloatingFeedback from "@/components/FloatingFeedback";
import AnalyticsTracker from "@/components/AnalyticsTracker";
import InstallExtensionModal from "@/components/InstallExtensionModal";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "vietnamese"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "JobFit AI | Trợ lý tìm việc & tối ưu CV",
  description: "Tải CV lên, để AI tìm việc phù hợp, chấm điểm độ khớp và gợi ý tối ưu CV — cam kết không bịa nội dung.",
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
            </ConsentProvider>
          </CreditsProvider>
        </AuthProvider>
      </body>
    </html>
  );
}

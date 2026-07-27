import type { Metadata, Viewport } from 'next';
import './globals.css';
import { SupabaseConfigProvider } from '@/lib/supabase-config-inject';
import { AuthProvider } from '@/lib/auth-context';
import { ResourcePreconnect } from '@/components/resource-preconnect';
import { Toaster } from '@/components/ui/sonner';

export const metadata: Metadata = {
  title: 'Image Relay Studio',
  description: 'AI 图像生成工作台',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="antialiased">
        <ResourcePreconnect />
        <SupabaseConfigProvider>
          <AuthProvider>
            {children}
            <Toaster />
          </AuthProvider>
        </SupabaseConfigProvider>
      </body>
    </html>
  );
}

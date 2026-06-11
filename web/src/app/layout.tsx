import type { Metadata } from 'next';
import './globals.css';
import { QueryProvider } from '@/lib/QueryProvider';
import { AuthProvider } from '@/contexts/AuthContext';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/toast';
import { Inter, JetBrains_Mono } from "next/font/google";
import { cn } from "@/lib/utils";

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Flotillas · Sala de control',
    template: '%s · Flotillas',
  },
  description: 'Plataforma B2B de gestión vehicular',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="es"
      className={cn("font-sans", inter.variable, jetbrainsMono.variable)}
      suppressHydrationWarning
    >
      <body>
        <ThemeProvider defaultTheme="light">
          <QueryProvider>
            <AuthProvider>
              {children}
              <Toaster />
            </AuthProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
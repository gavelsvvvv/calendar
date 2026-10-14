import { GoogleAnalytics } from "@next/third-parties/google";
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { TIME_ZONE_COOKIE } from "@/lib/timezone";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans-family",
  subsets: ["latin"],
  display: "swap",
});

/**
 * The GA4 destination.
 *
 * Read from the environment so a host can point a preview deployment somewhere
 * else or blank it, with the real ID as the fallback: `NEXT_PUBLIC_` values are
 * inlined at *build* time, so a variable that is missing on the build machine
 * silently produces a site with no analytics at all and no error to notice. The
 * literal removes that failure mode. It is a public identifier either way — it
 * ships in the client bundle and is readable in page source.
 */
const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || "G-FC9TGS890K";

export const metadata: Metadata = {
  title: {
    default: "Polymarket Calendar",
    template: "%s · Polymarket Calendar",
  },
  /*
   * Independence is stated in the description itself, not only in the page.
   *
   * Search results, link previews and share cards render this string in places
   * where none of the site's own chrome is visible, so a reader can meet the
   * name "Polymarket Calendar" with no way to tell whose site it is. Saying it
   * here costs nothing and is the version most likely to be seen first.
   */
  description:
    "An independent calendar of important Polymarket markets — see what resolves today, what's " +
    "coming this week, and which days carry the most volume. Not affiliated with or endorsed by Polymarket.",
  applicationName: "Polymarket Calendar",
  openGraph: {
    title: "Polymarket Calendar — independent calendar of Polymarket markets",
    description:
      "See which Polymarket markets resolve on which day, filtered by category, volume and " +
      "probability. An independent project, not affiliated with or endorsed by Polymarket.",
    type: "website",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0e0e11" },
  ],
  width: "device-width",
  initialScale: 1,
  // The month grid is dense; let people zoom it.
  maximumScale: 5,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      // next-themes writes the theme class here before paint; without this React
      // warns about the attribute it didn't render.
      suppressHydrationWarning
      className={`${inter.variable} h-full antialiased`}
    >
      <head>
        {/*
          Tell the server which timezone this browser is in, before anything
          else runs.

          The server cannot detect one, so it renders times from the zone this
          browser reported last time. That reporting used to happen in a React
          effect, which means it waited for the bundle to download, parse and
          hydrate — and until it did, a first-ever visit was looking at
          Polymarket's own timezone rather than its own. This runs in the head,
          synchronously, before the first paint, so the answer is already stored
          by the time anything else asks: the correction costs one render on one
          visit instead of one render on every cold load.

          It also self-heals a cookie that has gone wrong — a laptop opened in
          another country, a changed OS setting, a link opened through a proxy.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var z=Intl.DateTimeFormat().resolvedOptions().timeZone;if(z)document.cookie="${TIME_ZONE_COOKIE}="+encodeURIComponent(z)+";path=/;max-age=31536000;samesite=lax"}catch(e){}`,
          }}
        />
      </head>
      <body className="flex min-h-full flex-col bg-background">
        <ThemeProvider>{children}</ThemeProvider>
        {/*
          Google Analytics 4 — the stock `@next/third-parties` component, mounted
          exactly once, configured with nothing.

          It is rendered here, from a *server* component, and that is the whole
          fix. The version this replaced wrapped it in a `"use client"` component
          that read the measurement ID itself and bailed out when it was missing:

              "use client";
              const gaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
              if (!gaId) return null;

          Those two lines read differently on each side of the wire.
          `NEXT_PUBLIC_` values are substituted into the client bundle at *build*
          time, while the server reads the live environment at *runtime*. A build
          machine without the variable therefore produced a server render that
          emitted the `<link rel="preload">` for gtag.js — proof enough to make
          the page look correctly tagged — and a client bundle where the same
          component returned `null` and injected nothing. `window.dataLayer` and
          `window.gtag` were never defined and not one hit was ever sent. A
          preload fetches a file; it never runs it.

          Rendering from the server puts `gaId` in the RSC payload instead, so
          the client is handed the value rather than compiled with it, and the
          literal fallback above means it cannot be empty in the first place.

          There is deliberately no second `config` call. An earlier version added
          `gtag('config', id, {send_page_view: false})` so that this app's
          `history.replaceState` URL rewrites would not each be counted as a page
          view. That is a real problem and still worth solving — but stacked on
          top of a tag that was not loading at all, it only made it harder to see
          which half was broken. Basic collection first.
        */}
        <GoogleAnalytics gaId={GA_MEASUREMENT_ID} />
      </body>
    </html>
  );
}

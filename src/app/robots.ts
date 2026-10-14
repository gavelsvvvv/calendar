import type { MetadataRoute } from "next";

/**
 * `robots.txt`.
 *
 * Everything the site renders is public market data, so there is nothing to
 * hide from an indexer — but `/api/` is disallowed on purpose. Those routes are
 * the expensive ones, and a crawler walking month ranges is exactly the traffic
 * pattern the rate limiter exists to dampen. Keeping them out of the crawl
 * budget is cheaper for both sides than refusing the requests later.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/"] }],
    sitemap: "https://calendarpolymarket.com/sitemap.xml",
  };
}

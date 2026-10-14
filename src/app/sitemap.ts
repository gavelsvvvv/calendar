import type { MetadataRoute } from "next";

/**
 * `sitemap.xml`.
 *
 * One entry, because there is one page. Views, months and filters are query
 * state on `/` rather than routes, and listing permutations of them would
 * advertise crawl targets that each cost a dataset build. The API and the
 * calendar feeds are deliberately absent for the same reason.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://calendarpolymarket.com",
      lastModified: new Date(),
      changeFrequency: "hourly",
      priority: 1,
    },
  ];
}

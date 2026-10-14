/**
 * URL allowlisting for anything that leaves this app as a link.
 *
 * Every link we publish — into a subscriber's calendar, into a Google Calendar
 * template, into an `href` — has to survive being wrong. The market text and the
 * slugs behind these URLs come from Polymarket's public API, which for our
 * purposes is attacker-influenced: anyone who can create a market chooses them.
 *
 * The rule is that we build URLs, never adopt them. `buildEventUrl` in
 * `curation/curate.ts` already composes `https://polymarket.com/event/<slug>`
 * from a hardcoded origin, so this module is the second line: it re-checks the
 * finished string before it is serialized, and refuses anything that is not an
 * `https:` URL on a host we expect.
 *
 * That refusal matters because the sink is not always a browser. A calendar
 * client shows the URL property as a tappable link on a phone's lock screen, and
 * `javascript:` / `data:` / `file:` URIs are exactly what an allowlist is for —
 * a fixture carrying `javascript:alert(1)` reached the generated `URL:` line
 * before this existed.
 */

/** Hosts we will emit a link to. Exact match, or a subdomain of one. */
const ALLOWED_HOSTS = ["polymarket.com", "calendarpolymarket.com"] as const;

function hostAllowed(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/**
 * Whitespace and C0/DEL control characters.
 *
 * Never legitimate inside a URL, and each one is a parser-differential waiting
 * to happen: a raw CR splits an ICS content line, a raw space ends an HTTP
 * request target, and a tab is stripped by some URL parsers and not others.
 */
const URL_CONTROL = /[\u0000-\u0020\u007F]/;
const URL_CONTROL_GLOBAL = /[\u0000-\u0020\u007F]/g;

/**
 * The URL if it is one we are willing to publish, otherwise `null`.
 *
 * `new URL` does the parsing, which is the point: hand-rolled scheme checks miss
 * `JavaScript:` in mixed case, protocol-relative `//evil.test`, and embedded
 * credentials. Everything below is checked against the *parsed* result.
 */
export function safeExternalUrl(value: string | undefined | null): string | null {
  if (!value) return null;
  // Reject rather than strip: a URL that needed stripping is not one we built.
  if (URL_CONTROL.test(value)) return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  // Credentials in a URL are a phishing primitive: `https://polymarket.com@evil.test`
  // parses with hostname `evil.test` but reads as Polymarket to a human.
  if (url.username || url.password) return null;
  if (!hostAllowed(url.hostname)) return null;
  return url.toString();
}

/**
 * A Polymarket event URL built from a slug we treat as hostile.
 *
 * `encodeURIComponent` on the path segment, so a slug containing `?`, `#`, `/`
 * or a space cannot add a query, a fragment or a path segment of its own.
 */
export function polymarketEventUrl(slug: string | undefined | null): string {
  const base = "https://polymarket.com";
  if (!slug) return base;
  const clean = slug.replace(URL_CONTROL_GLOBAL, "").trim();
  if (!clean) return base;
  return `${base}/event/${encodeURIComponent(clean)}`;
}

/**
 * A calendar feed URL of ours, or `null`.
 *
 * Deliberately a *shape* check rather than a host allowlist. Feed URLs are
 * composed from the incoming request's origin, so the host legitimately varies —
 * `localhost:3000` in development, a Railway preview domain, the production
 * apex — and pinning the host here would break every environment but one while
 * adding nothing: the host is set by our own edge, not by the caller.
 *
 * What is worth checking is that the thing being handed to a calendar client is
 * one of our feed endpoints and not an arbitrary URL. `webcal://` is a
 * *subscription* instruction — iOS gives it to Calendar, which then polls that
 * address indefinitely — so a user-controlled value reaching that sink would be
 * a persistent, self-refreshing foothold in someone's calendar. The path prefix
 * is what makes that impossible.
 */
export function safeFeedUrl(value: string | undefined | null): string | null {
  if (!value) return null;
  if (URL_CONTROL.test(value)) return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (!["https:", "http:", "webcal:"].includes(url.protocol)) return null;
  if (url.username || url.password) return null;
  if (!url.pathname.startsWith("/api/calendar/")) return null;
  return url.toString();
}

/** Where a feed link points when the given one cannot be trusted. */
export const CANONICAL_FEED_URL = "https://calendarpolymarket.com/api/calendar/all.ics";

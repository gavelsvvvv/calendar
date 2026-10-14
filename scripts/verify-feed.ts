/**
 * Validates a live ICS feed against the parts of RFC 5545 a calendar client
 * actually enforces: CRLF endings, folded line length in octets, balanced
 * blocks, required properties, and UID stability across two separate requests.
 *
 *   npx tsx scripts/verify-feed.ts [baseUrl]
 */
const BASE = process.argv[2] ?? "http://127.0.0.1:3000";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

function unfold(ics: string): string[] {
  return ics.replace(/\r\n[ \t]/g, "").split("\r\n").filter(Boolean);
}

async function fetchFeed(path: string): Promise<{ body: string; type: string | null; status: number }> {
  const res = await fetch(`${BASE}${path}`);
  return { body: await res.text(), type: res.headers.get("content-type"), status: res.status };
}

async function validate(path: string) {
  console.log(`\n=== ${path} ===`);
  const { body, type, status } = await fetchFeed(path);
  check("responds 200", status === 200, String(status));
  check("Content-Type is text/calendar", Boolean(type?.includes("text/calendar")), type ?? "");
  check("starts with BEGIN:VCALENDAR", body.startsWith("BEGIN:VCALENDAR"));
  check("ends with END:VCALENDAR + CRLF", body.endsWith("END:VCALENDAR\r\n"));
  check("uses CRLF throughout (no bare LF)", !/[^\r]\n/.test(body));

  const lines = unfold(body);
  check("declares VERSION:2.0", lines.includes("VERSION:2.0"));
  check("declares a PRODID", lines.some((l) => l.startsWith("PRODID:")));
  const begins = lines.filter((l) => l === "BEGIN:VEVENT").length;
  const ends = lines.filter((l) => l === "END:VEVENT").length;
  check("VEVENT blocks are balanced", begins === ends, `${begins} begin / ${ends} end`);
  check("contains events", begins > 0, `${begins} events`);

  for (const prop of ["UID:", "DTSTAMP:", "SUMMARY:"]) {
    const n = lines.filter((l) => l.startsWith(prop)).length;
    check(`every VEVENT has ${prop.replace(":", "")}`, n === begins, `${n}/${begins}`);
  }
  const dtstarts = lines.filter((l) => l.startsWith("DTSTART")).length;
  check("every VEVENT has DTSTART", dtstarts === begins, `${dtstarts}/${begins}`);

  const encoder = new TextEncoder();
  const overlong = body.split("\r\n").filter((l) => encoder.encode(l).length > 75);
  check("all lines fold to <= 75 octets", overlong.length === 0, overlong.slice(0, 2).join(" | "));

  const uids = lines.filter((l) => l.startsWith("UID:"));
  check("UIDs are unique", new Set(uids).size === uids.length, `${uids.length} uids, ${new Set(uids).size} unique`);

  /*
   * Revision signalling.
   *
   * A stable UID stops a refresh adding a second copy; SEQUENCE and
   * LAST-MODIFIED are what let a client tell that the copy it already holds is
   * out of date. Without them a moved fixture is a familiar UID carrying a
   * DTSTART the client has no particular reason to prefer.
   */
  const sequences = lines.filter((l) => l.startsWith("SEQUENCE:"));
  check("every VEVENT carries a SEQUENCE", sequences.length === begins, `${sequences.length}/${begins}`);
  const seqValues = sequences.map((l) => Number(l.slice("SEQUENCE:".length)));
  check(
    "every SEQUENCE is a non-negative integer inside 32-bit range",
    seqValues.every((n) => Number.isInteger(n) && n >= 0 && n < 2_147_483_647),
    `min ${Math.min(...seqValues, 0)}, max ${Math.max(...seqValues, 0)}`,
  );
  const modified = lines.filter((l) => l.startsWith("LAST-MODIFIED:"));
  check(
    "LAST-MODIFIED is present and well formed where Gamma supplies one",
    modified.every((l) => /^LAST-MODIFIED:\d{8}T\d{6}Z$/.test(l)),
    `${modified.length}/${begins} events`,
  );

  /*
   * A tombstone is the only reason to publish something the calendar hides.
   * Anything CANCELLED here has to still be a complete VEVENT — same UID, same
   * required properties — or a client has nothing to match the retraction to.
   */
  const cancelled = lines.filter((l) => l === "STATUS:CANCELLED").length;
  check(
    "every event carries exactly one STATUS",
    lines.filter((l) => l.startsWith("STATUS:")).length === begins,
    `${cancelled} cancelled`,
  );

  /*
   * Outlook compatibility.
   *
   * Outlook ignores TRANSP and reads a Microsoft extension instead, so without
   * this every entry in a subscribed feed lands as *Busy* — a month of fixtures
   * would black out the subscriber's free/busy and make them look unavailable
   * to their colleagues. It also reads X-PUBLISHED-TTL rather than the RFC 7986
   * REFRESH-INTERVAL, so the feed states its cadence twice.
   */
  const free = lines.filter((l) => l === "X-MICROSOFT-CDO-BUSYSTATUS:FREE").length;
  check("every VEVENT is free in Outlook's own terms", free === begins, `${free}/${begins}`);
  check(
    "refresh cadence is stated for both Outlook and RFC 7986 clients",
    lines.some((l) => l.startsWith("X-PUBLISHED-TTL:")) &&
      lines.some((l) => l.startsWith("REFRESH-INTERVAL")),
  );

  const allDay = lines.filter((l) => l.startsWith("DTSTART;VALUE=DATE:")).length;
  console.log(`     (${allDay} all-day, ${dtstarts - allDay} timed)`);

  return uids;
}

async function main() {
  const uidsA = await validate("/api/calendar/all.ics");
  await validate("/api/calendar/politics.ics");
  await validate("/api/calendar/custom.ics?categories=politics,ai&minImportance=important");

  console.log("\n=== UID STABILITY ACROSS REQUESTS ===");
  const second = await fetchFeed("/api/calendar/all.ics");
  const uidsB = unfold(second.body).filter((l) => l.startsWith("UID:"));
  check("same UIDs on a second request (no duplicate events on refresh)",
    JSON.stringify(uidsA) === JSON.stringify(uidsB),
    `${uidsA.length} vs ${uidsB.length}`);

  console.log("\n=== AN EMPTY SELECTION IS AN EMPTY FEED ===");
  {
    /*
     * The one case an "empty means everything" shorthand gets catastrophically
     * wrong. A reader who pressed Clear and subscribed used to receive a feed
     * of all eleven categories; `categories=none` is the explicit token that
     * makes the two states distinguishable all the way through to the ICS.
     */
    const none = await fetchFeed("/api/calendar/custom.ics?categories=none");
    const lines = unfold(none.body);
    const events = lines.filter((l) => l === "BEGIN:VEVENT").length;
    check("an empty selection still serves a valid calendar", none.status === 200, String(none.status));
    check("…that is well formed", lines[0] === "BEGIN:VCALENDAR" && lines.at(-1) === "END:VCALENDAR");
    check("…and contains no events", events === 0, `${events} events`);
  }

  console.log("\n=== eSPORTS IS ITS OWN FEED ===");
  {
    const esports = await validate("/api/calendar/esports.ics");
    const sports = await validate("/api/calendar/sports.ics");
    const shared = esports.filter((u) => sports.includes(u));
    check("eSports carries events of its own", esports.length > 0, `${esports.length}`);
    // The split is only real if the two feeds are disjoint. An event in both
    // would mean a subscriber to each gets it twice.
    check(
      "no event appears in both Sports and eSports",
      shared.length === 0,
      shared.slice(0, 2).join(", "),
    );
    // And every category the UI offers has a working pretty URL behind it.
    for (const slug of ["politics", "elections", "crypto", "economy", "business",
                        "technology", "ai", "world", "culture"]) {
      const res = await fetchFeed(`/api/calendar/${slug}.ics`);
      check(`/${slug}.ics responds 200`, res.status === 200, String(res.status));
    }
  }

  console.log("\n=== NO SETTLED EVENT IS PUBLISHED IN THE FUTURE ===");
  {
    /*
     * A resolved market with a later deadline used to reach subscribers as an
     * upcoming entry. STATUS:CONFIRMED marks a settled event, so any of those
     * dated after today is the bug returning.
     */
    const feed = await fetchFeed("/api/calendar/all.ics");
    const lines = unfold(feed.body);
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    let start = "";
    let bad = 0;
    let confirmed = 0;
    for (const line of lines) {
      if (line.startsWith("DTSTART")) start = (line.split(":")[1] ?? "").slice(0, 8);
      if (line === "STATUS:CONFIRMED") {
        confirmed += 1;
        // A day of slack: an event settling today belongs on today.
        if (start > today) bad += 1;
      }
    }
    check(
      "settled events are never dated in the future",
      bad === 0,
      `${bad} of ${confirmed} settled entries`,
    );
  }

  console.log("\n=== UNKNOWN FEED ===");
  const bad = await fetchFeed("/api/calendar/nonsense.ics");
  check("unknown feed name 404s", bad.status === 404, String(bad.status));

  console.log(`\n${failures === 0 ? "FEED VALIDATION PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });

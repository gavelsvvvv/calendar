import { describe, expect, it } from "vitest";
import {
  ESPORTS,
  SPORTS,
  parseEsportSelection,
  parseSportSelection,
  resolveEsport,
  resolveEventKind,
  resolveLeague,
  resolveSport,
  serializeSelection,
} from "../taxonomy";

/**
 * The taxonomy's job is to be right about ambiguous words, and every case here
 * is one a naive implementation gets wrong.
 */
describe("sport resolution", () => {
  it("resolves the sports actually seen upstream", () => {
    expect(resolveSport(["tennis", "sports", "games"])).toBe("tennis");
    expect(resolveSport(["nfl", "sports"])).toBe("american-football");
    expect(resolveSport(["nba", "sports"])).toBe("basketball");
    expect(resolveSport(["mlb", "baseball", "sports"])).toBe("baseball");
    expect(resolveSport(["nhl", "sports"])).toBe("hockey");
  });

  it("treats a bare `football` tag as soccer, because Polymarket does", () => {
    // Verified against live data: `football` co-occurs with `premier-league`,
    // `la-liga` and `ligue-1` — never with `nfl`. American football is always
    // tagged `nfl`. Merging them would put the NFL in the Bundesliga bucket.
    expect(resolveSport(["football", "premier-league", "sports"])).toBe("soccer");
    expect(resolveSport(["nfl", "sports"])).not.toBe("soccer");
  });

  it("is case-insensitive, because upstream is not consistent", () => {
    // `EPL` arrives capitalised in the live feed.
    expect(resolveSport(["EPL", "sports"])).toBe("soccer");
    expect(resolveSport(["Tennis"])).toBe("tennis");
  });

  it("maps `lcs` to soccer, not League of Legends", () => {
    // tag_slug=lcs returns 100/100 soccer events (Leagues Cup). This has been
    // got wrong before; the assertion is here so it cannot be got wrong again.
    expect(resolveSport(["lcs", "sports"])).toBe("soccer");
    expect(resolveEsport(["lcs"])).toBeUndefined();
  });

  it("returns undefined for a sport nobody has mapped", () => {
    // The safe failure: unreachable by a targeted filter, never misfiled.
    expect(resolveSport(["kabaddi", "sports"])).toBeUndefined();
  });

  it("prefers the specific tag over the generic one", () => {
    expect(resolveSport(["nfl", "sports", "games"])).toBe("american-football");
  });
});

describe("esport resolution", () => {
  it("resolves the titles actually seen upstream", () => {
    expect(resolveEsport(["counter-strike-2", "esports"])).toBe("cs2");
    expect(resolveEsport(["league-of-legends", "esports"])).toBe("lol");
    expect(resolveEsport(["valorant", "esports"])).toBe("valorant");
  });

  it("folds aliases onto one canonical id", () => {
    for (const tag of ["cs2", "csgo", "counter-strike", "counter-strike-2"]) {
      expect(resolveEsport([tag])).toBe("cs2");
    }
    for (const tag of ["lol", "league-of-legends", "lec", "lpl", "lck"]) {
      expect(resolveEsport([tag])).toBe("lol");
    }
    for (const tag of ["dota", "dota2", "dota-2", "the-international"]) {
      expect(resolveEsport([tag])).toBe("dota2");
    }
  });
});

describe("league metadata", () => {
  it("retains the league without collapsing the sport", () => {
    expect(resolveSport(["wnba", "basketball"])).toBe("basketball");
    expect(resolveLeague(["wnba", "basketball"])).toEqual({ id: "wnba", label: "WNBA" });
    expect(resolveLeague(["nba"])).toEqual({ id: "nba", label: "NBA" });
  });
});

describe("event kind", () => {
  it("calls a tagged fixture a match", () => {
    expect(resolveEventKind(["games", "tennis"], "Norrie vs Navone")).toBe("match");
  });
  it("falls back to the title for an untagged fixture", () => {
    expect(resolveEventKind(["tennis"], "Alcaraz vs. Sinner")).toBe("match");
  });
  it("calls a winner market an outright", () => {
    expect(resolveEventKind(["tennis"], "2026 Men's US Open Winner (Tennis)")).toBe("outright");
  });
});

describe("selection serialization", () => {
  it("is canonical regardless of the order the user ticked", () => {
    // The cache-key requirement: `Football + Tennis` and `Tennis + Football`
    // are one key.
    expect(parseSportSelection("american-football,tennis")).toEqual(
      parseSportSelection("tennis,american-football"),
    );
    expect(serializeSelection(["tennis", "american-football"], 99)).toBe(
      serializeSelection(["american-football", "tennis"], 99),
    );
  });

  it("drops anything that is not a known id", () => {
    // Allowlisted by construction — nothing arbitrary reaches a URL or feed.
    expect(
      parseSportSelection("tennis,../../etc/passwd,<script>,american-football"),
    ).toEqual(["american-football", "tennis"]);
    // `nfl` is a *tag* we map onto `american-football`, not a selection id, so
    // it must not survive parsing either.
    expect(parseSportSelection("nfl")).toEqual([]);
    expect(parseEsportSelection("cs2,__proto__,DROP TABLE")).toEqual(["cs2"]);
  });

  it("omits the parameter when everything is selected", () => {
    expect(serializeSelection(SPORTS.map((s) => s.id), SPORTS.length)).toBeNull();
    expect(serializeSelection(ESPORTS.map((s) => s.id), ESPORTS.length)).toBeNull();
  });

  it("writes an explicit token for an empty selection", () => {
    expect(serializeSelection([], SPORTS.length)).toBe("none");
  });

  it("round-trips a partial selection", () => {
    const picked = ["tennis", "american-football", "basketball"];
    const s = serializeSelection(picked, SPORTS.length)!;
    expect(parseSportSelection(s).sort()).toEqual([...picked].sort());
  });
});

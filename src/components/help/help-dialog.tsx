"use client";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

type Section = {
  heading: string;
  body: string;
  /** Rendered as a plain bulleted list — no dashes doing the work of bullets. */
  items?: string[];
  footnote?: string;
  link?: { href: string; label: string };
};

const SECTIONS: Section[] = [
  {
    heading: "How the calendar works",
    body: "Each entry is a real-world event that has Polymarket markets attached to it: an election, a rate decision, a match, a product launch. Click one to see the details, then open it on Polymarket.",
  },
  {
    heading: "How events are selected",
    body: "Markets are pulled from Polymarket's public API, grouped into the event they belong to, scored, and ranked. Only events that clear a relevance bar for their category appear by default.",
  },
  {
    heading: "Why some markets are excluded",
    body: "Some markets repeat forever and describe no scheduled event, so they never reach the calendar:",
    items: [
      "Daily weather and temperature markets",
      "Short-term crypto, index and stock price ladders",
      "Duplicate derivatives such as exact score, turnout and margin of victory",
      "Recurring charts, leaderboards and soundbite counters",
    ],
    footnote: "Turn on “Include smaller markets” in the sidebar to reveal lower-volume events.",
  },
  {
    heading: "Event date vs market resolution date",
    body: "Where Polymarket publishes a kickoff time, the event sits on that. Otherwise it sits on the date its markets resolve, which for a market with no specific time shows as the day's trading close rather than an invented hour.",
  },
  {
    heading: "How importance is calculated",
    body: "Trading volume, liquidity, how many markets the event carries, how soon it is, whether it settles anything, and how big it is relative to its own category. A $200k sports market is a big one; a $200k political market is ordinary, so they are scored against different scales.",
  },
  {
    heading: "How calendar subscriptions work",
    body: "Subscribing gives your calendar app a public iCal feed URL that it re-polls on its own schedule. Events update in place rather than duplicating. Refresh timing is controlled by your calendar provider, not by this site. Google and Apple typically check within hours, Outlook up to once a day.",
    footnote:
      "Outlook comes in two flavours: a personal Microsoft account and a work or school one. They live on different hosts, so the dialog offers both, because the wrong one lands on a sign-in page for an account you don’t have. Either way you can paste the feed URL into Add calendar → Subscribe from web.",
  },
  {
    heading: "Something wrong?",
    body: "If an event is on the wrong date or shouldn't be here at all, get in touch.",
    link: { href: "https://x.com/gavelsvtw", label: "@gavelsvtw" },
  },
];

/** Everything a visitor might reasonably ask, in plain language. */
export function HelpDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg overflow-hidden p-0">
        <div className="border-b border-border px-5 py-4 pr-12">
          <DialogTitle className="text-[16px] font-semibold text-foreground">
            How it works
          </DialogTitle>
          <DialogDescription className="mt-0.5 text-[12px] text-muted-foreground">
            What this calendar shows, and how it decides.
          </DialogDescription>
        </div>

        <div className="max-h-[70vh] overflow-y-auto overscroll-contain scrollbar-slim px-5 py-4">
          <dl className="flex flex-col gap-5">
            {SECTIONS.map((section) => (
              <div key={section.heading}>
                <dt className="text-[13px] font-semibold tracking-tight text-foreground">
                  {section.heading}
                </dt>
                <dd className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                  {section.body}
                  {section.link && (
                    <>
                      {" "}
                      <a
                        href={section.link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent underline underline-offset-2"
                      >
                        {section.link.label}
                      </a>
                    </>
                  )}
                  {section.items && (
                    <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-4 marker:text-subtle-foreground">
                      {section.items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  )}
                  {section.footnote && <p className="mt-1.5">{section.footnote}</p>}
                </dd>
              </div>
            ))}
          </dl>

          <p className="mt-5 border-t border-border pt-4 text-[12px] leading-relaxed text-muted-foreground">
            Independent calendar built on public Polymarket data. Not affiliated
            with or endorsed by Polymarket. Built by gavelsv.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

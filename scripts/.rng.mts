import { getViewRange } from "../src/lib/calendar";
import { parseCalendarUrlState } from "../src/lib/url-state";
for (const q of ["view=week", "view=week&date=2026-08-10", "view=month", "view=agenda"]) {
  const st = parseCalendarUrlState(new URLSearchParams(q));
  const { start, end } = getViewRange(st.view, st.anchor);
  const days = (end.getTime() - start.getTime()) / 86400000;
  console.log(`${q.padEnd(28)} anchor=${st.anchor.toISOString()}  ${start.toISOString()} -> ${end.toISOString()}  (${days.toFixed(1)}d)`);
}

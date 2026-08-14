# Sheet schema & monthly tally

## Tabs (auto-created except `Projects`, which you fill in yourself)

**Projects** (you maintain this, except `UsedHours` -- see below)
| ProjectName | SlackChannel | Active | BudgetHours | StartDate | EndDate | DeadlineAlerted | UsedHours | Archived | RequiresCategories |
|---|---|---|---|---|---|---|---|---|---|

`BudgetHours`, `StartDate`, and `EndDate` are all optional (leave `EndDate`
blank for an ongoing project with no deadline). `BudgetHours` left blank
means uncapped; when set, it's a lifetime allocation (not scoped to a
month): the modal shows remaining hours next to the project, `/hours-report`
shows the balance at the start of the queried month and what's left after
it, and the bot posts a warning to `REPORT_CHANNEL_ID` when a project
crosses 90% and 100% used.
`StartDate`/`EndDate` gate whether a project shows up at all: it only
appears once `StartDate` arrives and automatically stops appearing after
`EndDate` passes, on top of the `Active` checkbox (which still works as a
manual pause independent of the dates). Once `EndDate` passes, the bot also
posts a "past deadline" warning to `REPORT_CHANNEL_ID` and sets
`DeadlineAlerted` to `TRUE` so it only fires once — clear it back to
`FALSE` (e.g. after pushing `EndDate` out) to allow another alert later.

`UsedHours` is a running total the bot maintains automatically (incremented
on every submission) so it can answer "how much budget is left" in O(1)
instead of rescanning all of `TimeEntries` on every `/log-hours` — that
scan is what caused `operation_timeout` errors as `TimeEntries` grew, since
Slack only allows ~3 seconds for a response. Don't hand-edit this column;
if it ever looks wrong (e.g. after manually editing `TimeEntries`), rerun
`backfillProjectUsedHours_` from the Apps Script editor to resync it.

`Archived` is independent of `Active`: `Active` (plus `StartDate`/`EndDate`)
governs whether a project shows up in the daily modal; `Archived` governs
whether it shows up on the dashboard at all (hidden by default, with a
"Show archived" toggle to bring it back). Toggle either one directly in
the sheet, or from Slack via `/hours-projects` (restricted to the Slack
user IDs in `PROJECT_ADMIN_SLACK_IDS`) — that command shows every
project's current state with **Activate/Deactivate** and **Archive/
Unarchive** buttons that update in place.

`RequiresCategories` controls whether the log-hours modal shows the
activity-category checkboxes (Research/Strat/Design/etc., see `Categories`
below) for that project at all. Leave it blank or `TRUE` for studio client
projects that want that detail; set it to `FALSE` for internal projects
that don't need to be broken down that granularly — the modal just shows
hours + note for those. Blank defaults to `TRUE` so existing projects are
unaffected until you opt one out.

**Users** (auto-synced from Slack nightly; `IncludeInReminders` is yours to edit)
| SlackUserID | SlackUserName | IncludeInReminders |
|---|---|---|

**TimeEntries** (append-only, written by the bot on every `/log-hours` submission)
| Timestamp | Date | SlackUserID | SlackUserName | Project | Hours | Note | Categories |
|---|---|---|---|---|---|---|---|

`Date` is stored as a `YYYY-MM-DD` string (the day the entry is for, not
necessarily the submission day -- the 9am missed-entry nudge lets someone
backfill a prior day). One row per project with nonzero hours per
submission, so a single evening's entry can produce multiple rows. `Note`
is per-project (the modal has a separate optional note field under each
project's hours field), not one shared note for the whole submission.

`Categories` is a comma-joined list of activity tags picked from checkboxes
in the modal (`Research`, `Strat`, `Design`, `Mtgs/Rev (internal)`,
`Client service`, `Admin`, `Other`) — multiple may be checked for one
entry, and picking `Other` adds a free-text field whose contents get
folded in as `Other: <text>`. An entry tagged with several categories
contributes its full hours to *each* tag when the dashboard tallies "hours
by category" (not a split fraction) — the idea is "what kinds of work
happened," not exact time-per-category accounting. Blank for entries
logged against a project with `RequiresCategories` set to `FALSE`, since
the modal doesn't show the checkboxes for those at all.

## Getting the monthly tally

You have two ways to see "hours per person per project, per month" without
writing any code:

### Option A: `/hours-report` in Slack (fastest)

Run `/hours-report` (defaults to the current month) or `/hours-report
2026-07` for a specific month. Posts one block per project, visible only to
you:

```
ASF-Field-Day:
  Month start     51.0h
  Alex             6.0h
  Lope             1.0h
  Michu            0.0h
  Remaining       44.0h

VAC-Exhibition:
  Month start     50.0h
  Alex            20.0h
  Lope            32.0h
  Michu            0.0h
  Remaining       -2.0h
```

"Month start" is the project's `BudgetHours` minus everything logged before
the 1st of that month; "Remaining" subtracts that month's hours too. Every
known team member gets a row, including 0 — so it also surfaces who hasn't
logged anything on a project. Projects with no `BudgetHours` set skip the
"Month start"/"Remaining" lines and show a plain "Total" instead. If
`REPORT_CHANNEL_ID` is set, the same report auto-posts to that channel on
the 1st of each month for the month that just ended.

### Option B: a live "MonthlyTally" tab in the Sheet

Useful if you want to filter/sort/export in Sheets, or hand it to someone
non-technical.

1. Add a new tab named `MonthlyTally`.
2. In cell `B1`, type the month you want, e.g. `2026-08`.
3. In cell `A3`, paste:

   ```
   =QUERY(TimeEntries!A2:G, "select D, E, sum(F) where B contains '"&$B$1&"' group by D, E order by D, E label D 'Person', E 'Project', sum(F) 'Hours'")
   ```

   This recalculates automatically whenever `TimeEntries` changes or you
   change the month in `B1`.

4. Optional: add a second QUERY below for per-project totals across
   everyone:

   ```
   =QUERY(TimeEntries!A2:G, "select E, sum(F) where B contains '"&$B$1&"' group by E order by E label E 'Project', sum(F) 'Total Hours'")
   ```

### Option C: a real Pivot Table

**Insert > Pivot table**, source = `TimeEntries!A:G`. Rows: `SlackUserName`,
then `Project`. Values: `Hours` (SUM). Filters: `Date`, condition "text
contains" your target month string (e.g. `2026-08`). Sheets remembers this
pivot's config, so you just flip the filter value each month.

### Option D: the dashboard (most useful for actually analyzing the data)

`docs/SETUP.md` step 6 deploys an interactive web page, restricted to the
Google accounts in `DASHBOARD_ALLOWED_EMAILS`. Unlike the other three
options it isn't locked to "the current month" — a toggle bar switches
between **week to date** (default), **this month**, **this quarter**,
**this year**, or a **custom** start/end range, plus filters for **person**,
**project**, and a **show archived** checkbox (archived projects are
hidden by default), and everything below re-fetches for whichever
combination is selected:

- **Project status cards** — for each project, two independent badges:
  a budget status (*On track* / *At risk* / *Over budget* / *Uncapped*) and
  a schedule status (*On schedule* / *Late* / *No deadline*), plus the
  all-time budget bar and hours logged in the selected range. "At risk"
  means the project is burning budget faster than its `StartDate`/`EndDate`
  window justifies (or, with no dates set, is at/above 90% used) — see the
  `ANALYTICS_AT_RISK_MARGIN_` comment in `Analytics.gs` if you want to
  tune that threshold.
- **"Where hours are going"** — a bar chart ranking projects by hours
  logged in the selected range.
- **Burn-down chart** — pick a project from the dropdown to see its
  cumulative all-time hours plotted day by day across the range, with a
  dashed reference line at its budget if one is set.
- **Hours by category** — a bar chart of the activity tags (see
  `TimeEntries` above) logged in the selected range.
- **By project / by person tables** — the same data both ways, scoped to
  the selected range and filters.
- **Who's spending time where** — per project, each person's hours and %
  share of that project's time in the range (the chosen proxy for
  "who's working where," since there's no per-task time estimate to
  compare against — see the note in `docs/SETUP.md`).
- **Export to Sheet** — writes the selected range/filters' raw entries (date,
  person, project, hours, note, categories) into an `Export` tab in the
  same Spreadsheet, overwriting it each time. That tab is a normal Sheet,
  so from there **File > Download** gives you XLSX/CSV/PDF.

`/hours-report` stays the fast, Slack-native, project-first summary; the
dashboard is where you go to actually dig into trends and status across
whatever window and filters you're asking about.

### Option E: `/hours-projects` in Slack (managing, not reporting)

Not a reporting view, but worth knowing about here: `/hours-projects`
(restricted to `PROJECT_ADMIN_SLACK_IDS`) lists every project with
**Activate/Deactivate** and **Archive/Unarchive** buttons, so you don't
need to open the Sheet to change a project's state. See the `Archived`
note above.

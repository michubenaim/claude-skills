# Sheet schema & monthly tally

## Tabs (auto-created except `Projects`, which you fill in yourself)

**Projects** (you maintain this)
| ProjectName | SlackChannel | Active |
|---|---|---|

**Users** (auto-synced from Slack nightly; `IncludeInReminders` is yours to edit)
| SlackUserID | SlackUserName | IncludeInReminders |
|---|---|---|

**TimeEntries** (append-only, written by the bot on every `/log-hours` submission)
| Timestamp | Date | SlackUserID | SlackUserName | Project | Hours | Note |
|---|---|---|---|---|---|---|

`Date` is stored as a `YYYY-MM-DD` string (the day the entry is for, not
necessarily the submission day). One row per project with nonzero hours per
submission, so a single evening's entry can produce multiple rows.

## Getting the monthly tally

You have two ways to see "hours per person per project, per month" without
writing any code:

### Option A: `/hours-report` in Slack (fastest)

Run `/hours-report` (defaults to the current month) or `/hours-report
2026-07` for a specific month. Posts a monospace table visible only to you.
If `REPORT_CHANNEL_ID` is set, the same report auto-posts to that channel on
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

# Hours Tracker for Slack

A free Slack bot for logging daily hours per project and getting a monthly
tally per team member per project — no subscriptions, no hosting bill.

- Every evening (weekdays), the bot DMs each team member a **Log hours**
  button (also reachable anytime via `/log-hours` or the **Log hours**
  global shortcut). Opens a modal listing your active projects; fill in
  hours, an optional per-project note, and any activity categories
  (Research, Strat, Design, Mtgs/Rev, Client service, Admin, Other) for
  whichever ones you touched today.
- Every weekday morning at 9:15am, anyone with zero hours logged for the
  last business day gets a follow-up nudge, with a button that opens the
  modal pre-set to backfill that missed day specifically.
- Projects are names you maintain in a Google Sheet, one per Slack channel
  you work in — or manage on/off/archived directly from Slack via
  `/hours-projects` (admin-only, see `docs/SETUP.md`).
- `/hours-report [YYYY-MM]` gives an on-demand report (defaults to the
  current month), one block per project: budget balance at the start of
  the month, every team member's hours that month (0 if they logged
  nothing), and what's left. An optional monthly auto-post does the same
  to a channel on the 1st.
- Projects can optionally carry a total hour budget; the modal shows
  remaining balance, and the bot posts a warning at 90% and 100% used.
- Projects can optionally carry a start/end date. `EndDate` is left blank
  for an ongoing project with no deadline; when set, the project
  auto-retires from the daily modal once it passes, and the bot posts a
  one-time "past deadline" alert.
- An interactive dashboard (`/hours-dashboard` or the **Open dashboard**
  shortcut gets you the link), restricted to Google accounts you approve:
  a week/month/quarter/year/custom-range toggle plus person/project
  filters drive project status badges (on track / at risk / over budget /
  late), a "where hours are going" chart, a per-project burn-down chart
  against budget, an hours-by-category chart, by-project and by-person
  tables, a per-project person-share breakdown, an archived-projects
  toggle, and an Export-to-Sheet button.
- All data lives in a Google Sheet you own, so a monthly pivot table /
  export is always one click away — see `docs/SHEET_SCHEMA.md`.

## Stack

Google Apps Script (the entire backend, including the HTTP endpoint Slack
calls) + Google Sheets (the database). Both are free with any Google
account. The Slack app is a plain internal app — created via manifest,
installed to your own workspace, no App Directory review or paid tier.

**Cost: $0.** No servers to run, no third-party platform account, nothing
that expires or needs a credit card.

## Why not build this into our existing Standup & Prosper bot?

We looked at it first — S&P supports custom questions, webhooks, and an
API — but webhook/API access is a paid-plan feature there, and the goal was
zero new spend. This bot runs standalone but is scheduled to DM people
around the same time as the nightly standup, so in practice it reads as
one ritual even though it's a separate app under the hood. The **Log
hours** global shortcut plus a direct link to DM the bot (Slack's own
"Copy link" on the app) can be pasted into an S&P custom question as
static text — a lightweight nudge inside the existing standup flow
without needing S&P's paid API.

## Get started

See [`docs/SETUP.md`](docs/SETUP.md) for the full walkthrough (create the
Sheet, deploy the Apps Script web app, create the Slack app from the
manifest in `docs/slack-app-manifest.yml`, wire up the reminder schedule).

## Layout

```
apps-script/
  Code.gs        HTTP entry points (doPost/doGet) -- slash commands, interactivity & dashboard routing
  Config.gs      Script Properties (secrets/config) accessors
  SlackApi.gs    Slack Web API calls + inbound request auth
  Sheets.gs      Google Sheets read/write helpers
  Modals.gs      Slack Block Kit view/message builders
  Triggers.gs    Evening reminder, missed-entry nudge, deadline check, monthly tally
  Budgets.gs     Project budget threshold-crossing warnings
  Analytics.gs   Timeframe resolution, tallies, project status classification
  Dashboard.gs   Interactive HTML dashboard (charts, tables, Sheet export)
  appsscript.json
docs/
  SETUP.md               step-by-step setup
  SHEET_SCHEMA.md         sheet tabs + how to pull a monthly tally
  slack-app-manifest.yml  paste-in Slack app manifest
```

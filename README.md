# Hours Tracker for Slack

A free Slack bot for logging daily hours per project and getting a monthly
tally per team member per project — no subscriptions, no hosting bill.

- Every evening (weekdays), the bot DMs each team member a **Log hours**
  button. It opens a modal listing your active projects; fill in hours for
  whichever ones you touched today.
- Projects are just names you maintain in a Google Sheet, one per Slack
  channel you work in (see `docs/SETUP.md`).
- `/hours-report [YYYY-MM]` gives an on-demand tally (defaults to the
  current month), broken down both by person and by project, for tracking
  productivity either way; an optional monthly auto-post does the same to
  a channel on the 1st.
- Projects can optionally carry a total hour budget; the modal shows
  remaining balance, and the bot posts a warning at 90% and 100% used.
- Projects can optionally carry a start/end date. `EndDate` is left blank
  for an ongoing project with no deadline; when set, the project
  auto-retires from the daily modal once it passes, and the bot posts a
  one-time "past deadline" alert.
- A read-only dashboard (project budget cards, flagged once past deadline,
  plus the current month's hours by person and by project), restricted to
  Google accounts you approve.
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
one ritual even though it's a separate app under the hood.

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
  Triggers.gs    Evening reminder + monthly tally scheduled functions
  Budgets.gs     Project budget threshold-crossing warnings
  Dashboard.gs   Read-only HTML dashboard (project budgets + monthly table)
  appsscript.json
docs/
  SETUP.md               step-by-step setup
  SHEET_SCHEMA.md         sheet tabs + how to pull a monthly tally
  slack-app-manifest.yml  paste-in Slack app manifest
```

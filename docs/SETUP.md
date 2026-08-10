# Setup

Everything runs on a free Google account (Sheets + Apps Script) and a free,
internal-only Slack app. No paid tier, no third-party hosting, no credit card.

## 1. Create the Google Sheet

1. Create a new Google Sheet (any name, e.g. "Team Hours").
2. Note its ID from the URL: `https://docs.google.com/spreadsheets/d/THIS_PART/edit`.
3. Add a `Projects` tab with header row
   `ProjectName | SlackChannel | Active | BudgetHours | StartDate | EndDate | DeadlineAlerted`,
   then one row per project you want people to log hours against, e.g.:

   | ProjectName | SlackChannel | Active | BudgetHours | StartDate | EndDate | DeadlineAlerted |
   |---|---|---|---|---|---|---|
   | Acme Rebrand | #acme-rebrand | TRUE | 120 | 2026-08-01 | 2026-10-15 | |
   | Internal Tools | #internal-tools | TRUE | | | | |

   `SlackChannel` is just for your own reference (which channel = which
   project); the bot doesn't read Slack channels automatically in v1.
   `BudgetHours`, `StartDate`, and `EndDate` are all optional — leave any of
   them blank if they don't apply (an ongoing project with no deadline just
   leaves `EndDate` blank). `BudgetHours` sets a total hours allocation to
   track draw-down (the modal shows remaining hours, and the bot posts a
   warning to `REPORT_CHANNEL_ID` at 90% and 100% used).
   `StartDate`/`EndDate` bound when a project shows up: it only appears in
   the daily modal once `StartDate` has arrived, and automatically stops
   appearing after `EndDate` passes — no need to remember to flip `Active`
   to `FALSE` when a project wraps. `Active` still works as a manual
   override for pausing a project without touching its dates. Once
   `EndDate` passes, the bot also posts a one-time "past deadline" warning
   to `REPORT_CHANNEL_ID` and leaves `DeadlineAlerted` set to `TRUE` so it
   doesn't repeat every day — leave that column blank/`FALSE` yourself, the
   bot manages it.

The `TimeEntries` and `Users` tabs are created automatically the first time
the script runs.

## 2. Create the Apps Script project

1. In the Sheet: **Extensions > Apps Script**.
2. Delete the default `Code.gs` stub, then create files matching the ones in
   `apps-script/` in this repo (`Code.gs`, `Config.gs`, `SlackApi.gs`,
   `Sheets.gs`, `Modals.gs`, `Triggers.gs`, `Budgets.gs`, `Dashboard.gs`) and
   paste in each file's contents.
   (If you use [`clasp`](https://github.com/google/clasp) instead, `clasp push`
   from the `apps-script/` folder does this for you.)
3. Open `appsscript.json` via **Project Settings > Show "appsscript.json"
   manifest file in editor**, and replace its contents with this repo's
   `apps-script/appsscript.json`. Set `timeZone` to your team's timezone
   (IANA name, e.g. `America/New_York`).

## 3. Generate a shared secret

Apps Script cannot read HTTP request headers, so Slack's usual
signing-secret verification doesn't work here (see the comment at the top
of `SlackApi.gs`). Instead we protect the endpoint with a random secret in
the URL itself.

1. In the Apps Script editor, select the `generateSharedSecret` function
   from the function dropdown and click **Run**.
2. Authorize the script when prompted.
3. Open **View > Logs** (or **Executions**) and copy the printed secret.

## 4. Set Script Properties

**Project Settings > Script Properties**, add:

| Property | Value |
|---|---|
| `SPREADSHEET_ID` | the Sheet ID from step 1 |
| `SLACK_SHARED_SECRET` | the secret from step 3 |
| `SLACK_BOT_TOKEN` | filled in after step 6 below (`xoxb-...`) |
| `REPORT_CHANNEL_ID` | optional: a channel ID to auto-post the monthly tally + budget warnings into |
| `REMINDER_HOUR` | optional: hour (0-23) to send the evening reminder, default `18` |
| `DASHBOARD_ALLOWED_EMAILS` | comma-separated emails/domains allowed to view the dashboard (step 6), e.g. `alex@co.com, @co.com` |

## 5. Deploy the Slack web app

This project has **two separate deployments from the same script**: one
that Slack calls (public, unauthenticated, protected by the shared secret),
and one for the dashboard (requires Google sign-in, checked against
`DASHBOARD_ALLOWED_EMAILS`). Apps Script supports multiple simultaneous
deployments of one project, each with its own URL and its own
Execute-as/access settings — do this one first.

1. **Deploy > New deployment > Web app**. Give it a description like "Slack".
2. Execute as: **Me**. Who has access: **Anyone**.
3. Deploy, then copy the Web app URL (`https://script.google.com/macros/s/.../exec`).
4. Your Slack Request URL for every command/interactivity field is:

   ```
   https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec?secret=YOUR_SHARED_SECRET
   ```

Re-deploy (**Deploy > Manage deployments > Edit this deployment > New
version**) any time you change the `.gs` files — editing them alone doesn't
update the live URL.

## 6. Deploy the dashboard

1. **Deploy > New deployment > Web app**. Give it a description like
   "Dashboard" (this is a second, independent deployment of the same
   project — don't edit the Slack one from step 5).
2. Execute as: **User accessing the web app**. Who has access: **Anyone**
   (this still forces a Google sign-in per visitor — "Anyone" here means
   "any Google account", not anonymous; the app then checks that account's
   email against `DASHBOARD_ALLOWED_EMAILS` and shows a plain "not
   authorized" page if it isn't listed).
3. Deploy, then share this URL (not the Slack one) with whoever should see
   the dashboard.

## 7. Create the Slack app

1. Go to [api.slack.com/apps](https://api.slack.com/apps) > **Create New App
   > From an app manifest**.
2. Pick your workspace.
3. Paste in `docs/slack-app-manifest.yml`, with every
   `REQUEST_URL_PLACEHOLDER` replaced with the Slack deployment URL from
   step 5 (not the dashboard URL).
4. Create the app, then **Install to Workspace**.
5. Under **OAuth & Permissions**, copy the **Bot User OAuth Token**
   (`xoxb-...`) into the `SLACK_BOT_TOKEN` script property from step 4.

This is an internal, single-workspace app — no Slack App Directory review
needed.

## 8. Install the reminder schedule

Back in the Apps Script editor, select `installTriggers_` from the function
dropdown and click **Run** once (authorize if prompted). This installs:

- A daily trigger (weekdays only) that DMs everyone in the `Users` sheet a
  "Log hours" button at `REMINDER_HOUR`.
- A monthly trigger on the 1st that posts the previous month's tally to
  `REPORT_CHANNEL_ID`, if you set one.
- A daily trigger (every day, including weekends) at 9am that checks every
  project's `EndDate` and posts a "past deadline" warning to
  `REPORT_CHANNEL_ID` the first time it finds one that's passed.
- A daily trigger (weekdays only) at 9:15am that DMs anyone who has zero
  hours logged for the last business day (Friday's, if today is Monday) --
  the button opens the modal pre-set to that missed date so they can
  backfill it directly.

## 9. Try it

In Slack, run `/log-hours` in any channel or DM with the bot. Fill in hours
(and an optional note) for whichever projects you worked on, submit, and
check the `TimeEntries` tab in the Sheet for the new row(s). Run
`/hours-report` to see the report for the current month, and open the
dashboard URL from step 6 (signed into an allowed Google account) to
explore it — toggle between week/month/quarter/year/custom, and try the
**Export to Sheet** button (writes the current range's raw entries to an
`Export` tab in the same Spreadsheet).

## Notes / limits

- The evening DM goes to everyone Slack returns from `users.list` (minus
  bots), synced into the `Users` tab. Flip `IncludeInReminders` to `FALSE`
  for anyone who shouldn't get the nightly ping.
- The modal shows every row in `Projects` with `Active = TRUE`. If your team
  runs many concurrent projects this list gets long — worth trimming
  `Active` projects per season rather than leaving everything on forever.
- The `?secret=` URL param is adequate protection for an internal tool with
  low-sensitivity data (hours worked, not secrets). If you want real
  Slack-signature (HMAC) verification, put a small Cloudflare Worker (free
  tier, no card required) in front that verifies `X-Slack-Signature` and
  forwards to this same Apps Script URL — everything else in this repo
  stays the same.
- If `DASHBOARD_ALLOWED_EMAILS` is unset, the dashboard denies everyone
  (fail closed) rather than defaulting to open access.
- Budget warnings only fire once per threshold crossing (90%, then 100%),
  computed from the before/after totals of each submission — so they won't
  spam the channel on every subsequent entry once a project is already over.
- The dashboard's "who's spending time where" view shows each person's
  hours and % share of a project's time, not a true actual-vs-estimate
  efficiency score — the sheet only tracks a project-level budget, not
  per-task estimates, so there's nothing to compare individual speed
  against. Share of hours is a reasonable proxy without adding a field to
  the daily modal; if you want the real thing later, that means adding a
  lightweight Tasks concept (task name + estimate) people pick when
  logging hours.
- If a Workspace member gets stuck in a loop on the dashboard's Google
  sign-in screen (approves access, then gets sent right back to the start),
  it's almost always your Workspace's **Security > API Controls > App
  Access Control** policy blocking unverified internal apps for non-admin
  users. A Workspace super admin needs to find the app there (it may only
  appear after someone has attempted access) and mark it **Trusted**.

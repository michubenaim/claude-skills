# Setup

Everything runs on a free Google account (Sheets + Apps Script) and a free,
internal-only Slack app. No paid tier, no third-party hosting, no credit card.

## 1. Create the Google Sheet

1. Create a new Google Sheet (any name, e.g. "Team Hours").
2. Note its ID from the URL: `https://docs.google.com/spreadsheets/d/THIS_PART/edit`.
3. Add a `Projects` tab with header row `ProjectName | SlackChannel | Active`,
   then one row per project you want people to log hours against, e.g.:

   | ProjectName | SlackChannel | Active |
   |---|---|---|
   | Acme Rebrand | #acme-rebrand | TRUE |
   | Internal Tools | #internal-tools | TRUE |

   `SlackChannel` is just for your own reference (which channel = which
   project); the bot doesn't read Slack channels automatically in v1. Set
   `Active` to `FALSE` to hide a finished project from the daily modal
   without deleting its history.

The `TimeEntries` and `Users` tabs are created automatically the first time
the script runs.

## 2. Create the Apps Script project

1. In the Sheet: **Extensions > Apps Script**.
2. Delete the default `Code.gs` stub, then create files matching the ones in
   `apps-script/` in this repo (`Code.gs`, `Config.gs`, `SlackApi.gs`,
   `Sheets.gs`, `Modals.gs`, `Triggers.gs`) and paste in each file's contents.
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
| `REPORT_CHANNEL_ID` | optional: a channel ID to auto-post the monthly tally into on the 1st |
| `REMINDER_HOUR` | optional: hour (0-23) to send the evening reminder, default `18` |

## 5. Deploy the web app

1. **Deploy > New deployment > Web app**.
2. Execute as: **Me**. Who has access: **Anyone**.
3. Deploy, then copy the Web app URL (`https://script.google.com/macros/s/.../exec`).
4. Your Slack Request URL for every command/interactivity field is:

   ```
   https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec?secret=YOUR_SHARED_SECRET
   ```

Re-deploy (**Deploy > Manage deployments > Edit > New version**) any time
you change the `.gs` files — editing them alone doesn't update the live URL.

## 6. Create the Slack app

1. Go to [api.slack.com/apps](https://api.slack.com/apps) > **Create New App
   > From an app manifest**.
2. Pick your workspace.
3. Paste in `docs/slack-app-manifest.yml`, with every
   `REQUEST_URL_PLACEHOLDER` replaced with the URL from step 5.
4. Create the app, then **Install to Workspace**.
5. Under **OAuth & Permissions**, copy the **Bot User OAuth Token**
   (`xoxb-...`) into the `SLACK_BOT_TOKEN` script property from step 4.

This is an internal, single-workspace app — no Slack App Directory review
needed.

## 7. Install the reminder schedule

Back in the Apps Script editor, select `installTriggers_` from the function
dropdown and click **Run** once (authorize if prompted). This installs:

- A daily trigger (weekdays only) that DMs everyone in the `Users` sheet a
  "Log hours" button at `REMINDER_HOUR`.
- A monthly trigger on the 1st that posts the previous month's tally to
  `REPORT_CHANNEL_ID`, if you set one.

## 8. Try it

In Slack, run `/log-hours` in any channel or DM with the bot. Fill in hours
for whichever projects you worked on, submit, and check the `TimeEntries`
tab in the Sheet for the new row. Run `/hours-report` to see the tally for
the current month.

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

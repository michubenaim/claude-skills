/**
 * Central place for reading configuration. All secrets live in
 * Script Properties (Project Settings > Script Properties in the Apps
 * Script editor), never in source, so this file is safe to commit.
 */

function getProp_(key, required) {
  var value = PropertiesService.getScriptProperties().getProperty(key);
  if (!value && required) {
    throw new Error('Missing required Script Property: ' + key);
  }
  return value;
}

function getSlackBotToken_() {
  return getProp_('SLACK_BOT_TOKEN', true);
}

function getSlackSharedSecret_() {
  return getProp_('SLACK_SHARED_SECRET', true);
}

function getSpreadsheetId_() {
  return getProp_('SPREADSHEET_ID', true);
}

// Optional: channel ID to post the automated monthly tally into.
// Leave the Script Property unset to skip the auto-post (the sheet
// tab and /hours-report command still work without it).
function getReportChannelId_() {
  return getProp_('REPORT_CHANNEL_ID', false);
}

// Hour (0-23, in the script's timezone) to send the evening reminder.
function getReminderHour_() {
  var v = getProp_('REMINDER_HOUR', false);
  return v ? parseInt(v, 10) : 18;
}

// Comma-separated allowlist for the dashboard, e.g.
// "alex@co.com, jamie@co.com, @co.com" -- entries starting with "@" match
// any address on that domain. Unset/empty means deny everyone (fail closed).
function getDashboardAllowedEmails_() {
  var v = getProp_('DASHBOARD_ALLOWED_EMAILS', false);
  return v ? v.split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean) : [];
}

// Comma-separated Slack user IDs (e.g. "U04QAL3TN, U08ABCDEF") allowed to
// activate/deactivate/archive projects via /hours-projects. Find a
// person's Slack user ID via their profile ("..." menu > Copy member ID).
// Unset/empty means nobody can use /hours-projects (fail closed).
function getProjectAdminIds_() {
  var v = getProp_('PROJECT_ADMIN_SLACK_IDS', false);
  return v ? v.split(',').map(function (s) { return s.trim(); }).filter(Boolean) : [];
}

function isProjectAdmin_(slackUserId) {
  return getProjectAdminIds_().indexOf(slackUserId) !== -1;
}

// The *dashboard* deployment's own web app URL (the "Execute as: User
// accessing the web app" one) -- distinct from the Slack deployment this
// script is actually running as when this getter is called. Apps Script
// has no built-in way to look up a sibling deployment's URL at runtime, so
// this is just a Script Property you set once after deploying the
// dashboard (see docs/SETUP.md). Used by /hours-dashboard and the "Open
// dashboard" shortcut.
function getDashboardUrl_() {
  return getProp_('DASHBOARD_URL', true);
}

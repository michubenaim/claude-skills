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

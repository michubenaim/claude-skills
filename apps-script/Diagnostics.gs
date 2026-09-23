/**
 * A single health-check function that surfaces the most common ways this
 * whole system silently breaks -- a revoked/rotated Slack bot token, a
 * missing Script Property, a wiped trigger, a Sheet that stopped getting
 * new rows -- without needing to dig through the Apps Script editor by
 * hand. Wired into the ?action=diagnostics admin endpoint (Code.gs) and
 * also callable directly via the Execution API for scripting/automation.
 * Never includes secret values themselves, only whether they're set.
 */
function runDiagnostics_() {
  var result = {};

  try {
    result.triggers = listTriggers_();
  } catch (e) {
    result.triggersError = String(e);
  }

  var props = PropertiesService.getScriptProperties();
  var requiredProps = ['SLACK_BOT_TOKEN', 'SLACK_SHARED_SECRET', 'SPREADSHEET_ID', 'DASHBOARD_URL'];
  var optionalProps = ['REPORT_CHANNEL_ID', 'PROJECT_ADMIN_SLACK_IDS', 'DASHBOARD_ALLOWED_EMAILS', 'REMINDER_HOUR'];
  result.scriptPropertiesSet = {};
  requiredProps.concat(optionalProps).forEach(function (key) {
    result.scriptPropertiesSet[key] = !!props.getProperty(key);
  });

  // The single most common reason a working integration "just stops":
  // the bot token was revoked, the app was reinstalled/reauthorized (which
  // issues a NEW token), or someone rotated it -- any of which makes every
  // Slack API call in this script start failing at once.
  try {
    var authTest = callSlackApi_('auth.test', {});
    result.slackAuthTest = { ok: authTest.ok, error: authTest.error || null, team: authTest.team || null, botUser: authTest.user || null };
  } catch (e) {
    result.slackAuthTest = { ok: false, error: String(e) };
  }

  try {
    var ss = getSpreadsheet_();
    var projectsSheet = ss.getSheetByName(PROJECTS_SHEET);
    var usersSheet = ss.getSheetByName(USERS_SHEET);
    var entriesSheet = ss.getSheetByName(TIME_ENTRIES_SHEET);
    result.sheets = {
      projectsRowCount: projectsSheet ? projectsSheet.getLastRow() - 1 : null,
      projectsHeaders: projectsSheet ? projectsSheet.getRange(1, 1, 1, projectsSheet.getLastColumn()).getValues()[0] : null,
      usersRowCount: usersSheet ? usersSheet.getLastRow() - 1 : null,
      entriesRowCount: entriesSheet ? entriesSheet.getLastRow() - 1 : null
    };
    if (entriesSheet && entriesSheet.getLastRow() > 1) {
      var startRow = Math.max(2, entriesSheet.getLastRow() - 4);
      var recent = entriesSheet.getRange(startRow, 1, entriesSheet.getLastRow() - startRow + 1, 2).getValues();
      result.sheets.mostRecentEntryDates = recent.map(function (r) { return formatDate_(r[1]); });
    }
  } catch (e) {
    result.sheetsError = String(e);
  }

  try {
    result.reminderRecipientCount = getReminderRecipients_().length;
  } catch (e) {
    result.reminderRecipientError = String(e);
  }

  try {
    result.projectSchemaExpected = PROJECTS_HEADERS;
  } catch (e) {
    // ignore -- purely informational
  }

  return JSON.stringify(result, null, 2);
}

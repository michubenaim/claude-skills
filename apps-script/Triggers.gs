/**
 * Time-driven functions. None of these run automatically until you run
 * installTriggers_() once from the Apps Script editor (Run menu) -- see
 * docs/SETUP.md step 8.
 */

var TRIGGER_FUNCTIONS_ = ['sendEveningReminders', 'postMonthlyTally', 'checkProjectDeadlines', 'checkMissingEntries'];

function installTriggers_() {
  removeTriggers_();
  ScriptApp.newTrigger('sendEveningReminders')
    .timeBased()
    .everyDays(1)
    .atHour(getReminderHour_())
    .nearMinute(0)
    .create();
  ScriptApp.newTrigger('postMonthlyTally')
    .timeBased()
    .onMonthDay(1)
    .atHour(8)
    .nearMinute(0)
    .create();
  // Runs every day, weekends included -- deadlines don't wait for Monday.
  ScriptApp.newTrigger('checkProjectDeadlines')
    .timeBased()
    .everyDays(1)
    .atHour(9)
    .nearMinute(0)
    .create();
  // Weekdays only -- nudges anyone who didn't log hours for the last
  // business day (Friday's, if today is Monday).
  ScriptApp.newTrigger('checkMissingEntries')
    .timeBased()
    .everyDays(1)
    .atHour(9)
    .nearMinute(15)
    .create();
}

function removeTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (TRIGGER_FUNCTIONS_.indexOf(t.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(t);
    }
  });
}

function sendEveningReminders() {
  var day = new Date().getDay();
  if (day === 0 || day === 6) return; // skip weekends

  syncUsersSheet_(slackListUsers_());
  var recipients = getReminderRecipients_();
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var text = "Time to log today's hours!";
  var blocks = buildReminderBlocks_(today, ':clock8: ' + text);

  recipients.forEach(function (userId) {
    var dm = slackOpenDm_(userId);
    if (dm.ok) {
      slackPostMessage_(dm.channel.id, text, blocks);
    }
  });
}

// Weekdays only. Finds the last business day (Friday, if today is Monday)
// and DMs anyone in the reminder roster who has zero TimeEntries rows for
// that date -- the button opens the modal pre-targeted at that missed day
// (via buildReminderBlocks_'s dateStr), so they can backfill it directly
// rather than only ever being able to log "today".
function checkMissingEntries() {
  var day = new Date().getDay();
  if (day === 0 || day === 6) return; // skip weekends

  var targetDate = lastBusinessDateStr_(new Date());
  var loggedUserIds = getUserIdsWithEntriesOnDate_(targetDate);
  var recipients = getReminderRecipients_();
  var text = "You didn't log hours for " + targetDate + " -- want to add them now?";
  var blocks = buildReminderBlocks_(targetDate, ':wave: ' + text);

  recipients.forEach(function (userId) {
    if (loggedUserIds[userId]) return;
    var dm = slackOpenDm_(userId);
    if (dm.ok) {
      slackPostMessage_(dm.channel.id, text, blocks);
    }
  });
}

// The most recent weekday strictly before `date` -- Monday maps back to
// the prior Friday, every other weekday just maps back one day.
function lastBusinessDateStr_(date) {
  var d = new Date(date);
  var day = d.getDay();
  var daysBack = day === 1 ? 3 : (day === 0 ? 2 : 1);
  d.setDate(d.getDate() - daysBack);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

// Runs on the 1st of the month; reports on the month that just ended.
function postMonthlyTally() {
  var reportChannel = getReportChannelId_();
  if (!reportChannel) return; // no channel configured, skip auto-post

  var lastMonth = new Date();
  lastMonth.setMonth(lastMonth.getMonth() - 1);
  var monthStr = Utilities.formatDate(lastMonth, Session.getScriptTimeZone(), 'yyyy-MM');

  var byProject = transposeTally_(computeMonthlyTally_(monthStr));
  var text = formatMonthProjectReport_(monthStr, getAllProjects_(), getAllKnownUserNames_(), byProject, getProjectUsedBeforeMonth_(monthStr));
  slackPostMessage_(reportChannel, text);
}

// Posts a warning to REPORT_CHANNEL_ID the first time a project's EndDate
// is found to be in the past, then marks DeadlineAlerted so it won't repeat
// every day. Projects with no EndDate (ongoing, no deadline) are skipped.
function checkProjectDeadlines() {
  var reportChannel = getReportChannelId_();
  if (!reportChannel) return;

  var sheet = getOrCreateSheet_(PROJECTS_SHEET, PROJECTS_HEADERS);
  var rows = sheet.getDataRange().getValues();
  var today = new Date();

  for (var i = 1; i < rows.length; i++) {
    var name = rows[i][0];
    if (!name) continue;
    var endDate = parseSheetDate_(rows[i][5]);
    if (!endDate) continue;

    var alertedFlag = rows[i][6];
    var alreadyAlerted = alertedFlag === true || String(alertedFlag).toUpperCase() === 'TRUE';
    if (alreadyAlerted || today <= endOfDay_(endDate)) continue;

    slackPostMessage_(reportChannel,
      ':rotating_light: *' + name + '* is past its deadline (' + formatDate_(endDate) + ').');
    sheet.getRange(i + 1, 7).setValue(true); // DeadlineAlerted column
  }
}

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

// Wired into the ?action=reinstallTriggers admin endpoint: clears and
// recreates the four scheduled triggers, then immediately reports what's
// installed -- a one-click way to recover from triggers that were somehow
// removed (a revoked authorization, a manual deletion in the Triggers UI)
// without needing the Apps Script editor.
function reinstallAndReport_() {
  installTriggers_();
  return 'Reinstalled. ' + listTriggers_();
}

// Diagnostic (wired into the ?action= admin endpoint as listTriggers): Apps
// Script's Trigger objects don't expose their schedule (hour/minute) once
// created, but this at least confirms whether the four scheduled functions
// are actually installed right now and how many, since "it's not
// triggering every day" is equally explained by the trigger having been
// removed/never (re-)installed as by it firing-and-failing.
function listTriggers_() {
  var triggers = ScriptApp.getProjectTriggers();
  var relevant = triggers.filter(function (t) { return TRIGGER_FUNCTIONS_.indexOf(t.getHandlerFunction()) !== -1; });
  var byHandler = {};
  relevant.forEach(function (t) { byHandler[t.getHandlerFunction()] = (byHandler[t.getHandlerFunction()] || 0) + 1; });

  var lines = TRIGGER_FUNCTIONS_.map(function (name) {
    var count = byHandler[name] || 0;
    var lastRun = PropertiesService.getScriptProperties().getProperty('LAST_RUN_' + name);
    return name + ': ' + count + ' installed' + (count > 1 ? ' (DUPLICATE -- rerun installTriggers_)' : '') +
      (lastRun ? ', last completed ' + lastRun : ', never recorded a completed run');
  });
  var summary = lines.join('\n');
  Logger.log(summary);
  return summary;
}

// Wraps a trigger's real work so an uncaught exception (a transient Slack
// API/network error, a Sheets hiccup) can't silently kill the whole
// function -- which otherwise means EVERYONE who would've been reminded
// after the failure point just doesn't get reminded that day, with nothing
// visible unless someone happens to check Executions. On success, records
// a timestamp so listTriggers_/checkMissingEntries's watchdog can tell
// whether a run actually completed recently. On failure, posts to
// REPORT_CHANNEL_ID (if set) so the team finds out the same day instead of
// only noticing a missing reminder after the fact.
function runTriggerSafely_(name, fn) {
  try {
    fn();
    PropertiesService.getScriptProperties().setProperty('LAST_RUN_' + name,
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'));
  } catch (err) {
    Logger.log(name + ' failed: ' + err);
    try {
      var reportChannel = getReportChannelId_();
      if (reportChannel) {
        slackPostMessage_(reportChannel, ':rotating_light: Scheduled job *' + name + '* failed today: ' + err);
      }
    } catch (notifyErr) {
      Logger.log('Also failed to post the failure notice: ' + notifyErr);
    }
  }
}

function sendEveningReminders() {
  runTriggerSafely_('sendEveningReminders', sendEveningReminders_);
}

function sendEveningReminders_() {
  var day = new Date().getDay();
  if (day === 0 || day === 6) return; // skip weekends

  // A hiccup syncing Slack's user list shouldn't block reminding people
  // who are already in the Users sheet -- worst case a brand-new hire
  // waits one more day to be added to the roster.
  try {
    syncUsersSheet_(slackListUsers_());
  } catch (err) {
    Logger.log('syncUsersSheet_ failed, continuing with existing roster: ' + err);
  }

  var recipients = getReminderRecipients_();
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var text = "Time to log today's hours!";
  var blocks = buildReminderBlocks_(today, ':clock8: ' + text);

  recipients.forEach(function (userId) {
    try {
      var dm = slackOpenDm_(userId);
      if (dm.ok) {
        slackPostMessage_(dm.channel.id, text, blocks);
      }
    } catch (err) {
      Logger.log('Failed to remind ' + userId + ': ' + err);
    }
  });
}

// Weekdays only. Finds the last business day (Friday, if today is Monday)
// and DMs anyone in the reminder roster who has zero TimeEntries rows for
// that date -- the button opens the modal pre-targeted at that missed day
// (via buildReminderBlocks_'s dateStr), so they can backfill it directly
// rather than only ever being able to log "today". Also doubles as a
// watchdog for the evening reminder (see verifyEveningReminderRan_).
function checkMissingEntries() {
  runTriggerSafely_('checkMissingEntries', checkMissingEntries_);
}

function checkMissingEntries_() {
  var day = new Date().getDay();
  if (day === 0 || day === 6) return; // skip weekends

  verifyEveningReminderRan_();

  var targetDate = lastBusinessDateStr_(new Date());
  var loggedUserIds = getUserIdsWithEntriesOnDate_(targetDate);
  var recipients = getReminderRecipients_();
  var text = "You didn't log hours for " + targetDate + " -- want to add them now?";
  var blocks = buildReminderBlocks_(targetDate, ':wave: ' + text);

  recipients.forEach(function (userId) {
    if (loggedUserIds[userId]) return;
    try {
      var dm = slackOpenDm_(userId);
      if (dm.ok) {
        slackPostMessage_(dm.channel.id, text, blocks);
      }
    } catch (err) {
      Logger.log('Failed to nudge ' + userId + ': ' + err);
    }
  });
}

// Checks that sendEveningReminders_ actually completed within the last 2
// days (covers a Monday check looking back to Friday). If Apps Script's own
// scheduler silently skipped firing the trigger at all -- not something a
// try/catch inside the function itself can ever detect, since the function
// never ran -- this is what surfaces it, via a Slack alert instead of
// someone eventually noticing they stopped getting reminded.
function verifyEveningReminderRan_() {
  var lastRun = PropertiesService.getScriptProperties().getProperty('LAST_RUN_sendEveningReminders');
  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 2);
  var lastRunDate = lastRun ? new Date(lastRun.replace(' ', 'T')) : null;

  if (lastRunDate && lastRunDate >= cutoff) return; // ran recently, nothing to flag

  var reportChannel = getReportChannelId_();
  if (!reportChannel) return;
  slackPostMessage_(reportChannel,
    ':rotating_light: The evening hours reminder hasn\'t completed in the last 2 days' +
    (lastRun ? ' (last completed ' + lastRun + ')' : ' (no completed run on record)') +
    ' -- check Apps Script > Executions, or re-run installTriggers_ if it\'s stopped firing.');
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
  runTriggerSafely_('postMonthlyTally', postMonthlyTally_);
}

function postMonthlyTally_() {
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
// every day. Projects with no EndDate (ongoing, no deadline) are skipped,
// as are projects with a CompletedDate set -- a project that's already been
// delivered shouldn't get a "past deadline" nag just because its EndDate
// has since gone by.
function checkProjectDeadlines() {
  runTriggerSafely_('checkProjectDeadlines', checkProjectDeadlines_);
}

function checkProjectDeadlines_() {
  var reportChannel = getReportChannelId_();
  if (!reportChannel) return;

  var sheet = getOrCreateSheet_(PROJECTS_SHEET, PROJECTS_HEADERS);
  var rows = sheet.getDataRange().getValues();
  var today = new Date();

  for (var i = 1; i < rows.length; i++) {
    try {
      var name = rows[i][0];
      if (!name) continue;
      var endDate = parseSheetDate_(rows[i][5]);
      if (!endDate) continue;
      if (parseSheetDate_(rows[i][PROJECTS_COMPLETED_DATE_COL_ - 1])) continue;

      var alertedFlag = rows[i][6];
      var alreadyAlerted = alertedFlag === true || String(alertedFlag).toUpperCase() === 'TRUE';
      if (alreadyAlerted || today <= endOfDay_(endDate)) continue;

      slackPostMessage_(reportChannel,
        ':rotating_light: *' + name + '* is past its deadline (' + formatDate_(endDate) + ').');
      sheet.getRange(i + 1, 7).setValue(true); // DeadlineAlerted column
    } catch (err) {
      Logger.log('checkProjectDeadlines_ row ' + i + ' failed: ' + err);
    }
  }
}

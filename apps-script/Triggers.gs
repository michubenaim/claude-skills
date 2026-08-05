/**
 * Time-driven functions. None of these run automatically until you run
 * installTriggers() once from the Apps Script editor (Run menu) -- see
 * docs/SETUP.md step 6.
 */

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
}

function removeTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendEveningReminders' || t.getHandlerFunction() === 'postMonthlyTally') {
      ScriptApp.deleteTrigger(t);
    }
  });
}

function sendEveningReminders() {
  var day = new Date().getDay();
  if (day === 0 || day === 6) return; // skip weekends

  syncUsersSheet_(slackListUsers_());
  var recipients = getReminderRecipients_();
  var blocks = buildReminderBlocks_();

  recipients.forEach(function (userId) {
    var dm = slackOpenDm_(userId);
    if (dm.ok) {
      slackPostMessage_(dm.channel.id, "Time to log today's hours!", blocks);
    }
  });
}

// Runs on the 1st of the month; reports on the month that just ended.
function postMonthlyTally() {
  var reportChannel = getReportChannelId_();
  if (!reportChannel) return; // no channel configured, skip auto-post

  var lastMonth = new Date();
  lastMonth.setMonth(lastMonth.getMonth() - 1);
  var monthStr = Utilities.formatDate(lastMonth, Session.getScriptTimeZone(), 'yyyy-MM');

  var tally = computeMonthlyTally_(monthStr);
  var text = formatTallyMessage_(monthStr, tally);
  slackPostMessage_(reportChannel, text);
}

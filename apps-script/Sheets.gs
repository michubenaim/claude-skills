/**
 * All Google Sheets read/write logic. Sheet tabs:
 *
 * Projects     | ProjectName | SlackChannel | Active | BudgetHours | StartDate | EndDate | DeadlineAlerted
 * TimeEntries  | Timestamp | Date | SlackUserID | SlackUserName | Project | Hours | Note
 * Users        | SlackUserID | SlackUserName | IncludeInReminders
 *
 * Projects and Users are edited by a human admin (Active / IncludeInReminders
 * columns). BudgetHours, StartDate and EndDate are all optional.
 * DeadlineAlerted is written by the bot (Triggers.gs) once it has posted a
 * past-deadline warning for that project, so it only fires once -- clear it
 * back to FALSE to allow another alert (e.g. after pushing EndDate out and
 * it passes again). TimeEntries is append-only, written by the bot. A
 * MonthlyTally tab (created once, manually) reads TimeEntries via QUERY
 * formulas -- see docs/SHEET_SCHEMA.md.
 */

var PROJECTS_SHEET = 'Projects';
var TIME_ENTRIES_SHEET = 'TimeEntries';
var USERS_SHEET = 'Users';
var PROJECTS_HEADERS = ['ProjectName', 'SlackChannel', 'Active', 'BudgetHours', 'StartDate', 'EndDate', 'DeadlineAlerted'];

function getSpreadsheet_() {
  return SpreadsheetApp.openById(getSpreadsheetId_());
}

function getOrCreateSheet_(name, headers) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// Returns every row in Projects as { name, channel, active, budget,
// startDate, endDate, overdue }. `active` folds together the manual Active
// checkbox AND the StartDate/EndDate window: a project with Active=TRUE but
// a StartDate in the future, or an EndDate that's passed, comes back
// active:false -- so a project auto-retires on its EndDate without anyone
// having to remember to flip the checkbox. `overdue` is true once EndDate
// has passed, independent of `active`, so callers can flag it even though
// it's no longer showing in the daily modal. startDate/endDate are Date
// objects or null (EndDate is optional -- leave it blank for an ongoing
// project with no deadline). budget is a Number, or null if BudgetHours is
// blank (uncapped).
function getAllProjects_() {
  var sheet = getOrCreateSheet_(PROJECTS_SHEET, PROJECTS_HEADERS);
  var rows = sheet.getDataRange().getValues();
  var today = new Date();
  var projects = [];
  for (var i = 1; i < rows.length; i++) {
    var name = rows[i][0];
    if (!name) continue;
    var activeFlag = rows[i][2];
    var budgetRaw = rows[i][3];
    var startDate = parseSheetDate_(rows[i][4]);
    var endDate = parseSheetDate_(rows[i][5]);
    var overdue = !!endDate && today > endOfDay_(endDate);
    var withinWindow = (!startDate || today >= startDate) && !overdue;

    projects.push({
      name: name,
      channel: rows[i][1],
      active: (activeFlag === true || String(activeFlag).toUpperCase() === 'TRUE') && withinWindow,
      budget: (budgetRaw === '' || budgetRaw === null || budgetRaw === undefined) ? null : Number(budgetRaw),
      startDate: startDate,
      endDate: endDate,
      overdue: overdue
    });
  }
  return projects;
}

function getActiveProjects_() {
  return getAllProjects_().filter(function (p) { return p.active; });
}

function parseSheetDate_(value) {
  if (!value || value === '') return null;
  if (Object.prototype.toString.call(value) === '[object Date]') return value;
  var parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function endOfDay_(date) {
  var d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function appendTimeEntries_(userId, userName, dateStr, projectHours, note) {
  var sheet = getOrCreateSheet_(TIME_ENTRIES_SHEET,
    ['Timestamp', 'Date', 'SlackUserID', 'SlackUserName', 'Project', 'Hours', 'Note']);
  var now = new Date();
  var rows = [];
  Object.keys(projectHours).forEach(function (project) {
    var hours = projectHours[project];
    if (hours > 0) {
      rows.push([now, dateStr, userId, userName, project, hours, note || '']);
    }
  });
  if (rows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  }
  return rows.length;
}

// Merges live Slack users.list results into the Users sheet: adds anyone new
// (defaulting IncludeInReminders to TRUE) and leaves existing rows/flags
// alone, so an admin can flip someone to FALSE to opt them out permanently.
function syncUsersSheet_(slackUsers) {
  var sheet = getOrCreateSheet_(USERS_SHEET, ['SlackUserID', 'SlackUserName', 'IncludeInReminders']);
  var rows = sheet.getDataRange().getValues();
  var known = {};
  for (var i = 1; i < rows.length; i++) {
    known[rows[i][0]] = true;
  }
  var toAdd = [];
  slackUsers.forEach(function (u) {
    if (!known[u.id]) {
      toAdd.push([u.id, u.real_name || u.name, true]);
    }
  });
  if (toAdd.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, toAdd.length, toAdd[0].length).setValues(toAdd);
  }
}

function getReminderRecipients_() {
  var sheet = getOrCreateSheet_(USERS_SHEET, ['SlackUserID', 'SlackUserName', 'IncludeInReminders']);
  var rows = sheet.getDataRange().getValues();
  var recipients = [];
  for (var i = 1; i < rows.length; i++) {
    var id = rows[i][0];
    var include = rows[i][2];
    if (id && (include === true || String(include).toUpperCase() === 'TRUE' || include === '')) {
      recipients.push(id);
    }
  }
  return recipients;
}

// Returns { userName: { projectName: totalHours, ... }, ... } for entries
// whose Date (YYYY-MM-DD) falls in the given month (YYYY-MM).
function computeMonthlyTally_(monthStr) {
  var sheet = getOrCreateSheet_(TIME_ENTRIES_SHEET,
    ['Timestamp', 'Date', 'SlackUserID', 'SlackUserName', 'Project', 'Hours', 'Note']);
  var rows = sheet.getDataRange().getValues();
  var tally = {};
  for (var i = 1; i < rows.length; i++) {
    var dateStr = formatDate_(rows[i][1]);
    if (dateStr.indexOf(monthStr) !== 0) continue;
    var userName = rows[i][3];
    var project = rows[i][4];
    var hours = Number(rows[i][5]) || 0;
    if (!tally[userName]) tally[userName] = {};
    tally[userName][project] = (tally[userName][project] || 0) + hours;
  }
  return tally;
}

// Returns { projectName: totalHoursEverLogged }. Budgets are a lifetime
// allocation (not scoped to a month), so this scans every TimeEntries row.
function getProjectTotalsAllTime_() {
  var sheet = getOrCreateSheet_(TIME_ENTRIES_SHEET,
    ['Timestamp', 'Date', 'SlackUserID', 'SlackUserName', 'Project', 'Hours', 'Note']);
  var rows = sheet.getDataRange().getValues();
  var totals = {};
  for (var i = 1; i < rows.length; i++) {
    var project = rows[i][4];
    var hours = Number(rows[i][5]) || 0;
    totals[project] = (totals[project] || 0) + hours;
  }
  return totals;
}

// Returns { projectName: hoursLoggedStrictlyBeforeThisMonth }. Used to
// compute a project's budget balance as of the start of a given month
// (budget - this), separate from what gets logged during the month itself.
function getProjectUsedBeforeMonth_(monthStr) {
  var sheet = getOrCreateSheet_(TIME_ENTRIES_SHEET,
    ['Timestamp', 'Date', 'SlackUserID', 'SlackUserName', 'Project', 'Hours', 'Note']);
  var rows = sheet.getDataRange().getValues();
  var cutoff = monthStr + '-01';
  var totals = {};
  for (var i = 1; i < rows.length; i++) {
    var dateStr = formatDate_(rows[i][1]);
    if (dateStr >= cutoff) continue;
    var project = rows[i][4];
    var hours = Number(rows[i][5]) || 0;
    totals[project] = (totals[project] || 0) + hours;
  }
  return totals;
}

// Every person who's either in the Users roster or has ever logged an
// entry, unioned so nobody who's logged time is missed even if the Users
// sheet hasn't synced them yet. Used to show "0 hours" rows for people who
// didn't report on a given project, not just the people who did.
function getAllKnownUserNames_() {
  var names = {};
  var usersSheet = getOrCreateSheet_(USERS_SHEET, ['SlackUserID', 'SlackUserName', 'IncludeInReminders']);
  var userRows = usersSheet.getDataRange().getValues();
  for (var i = 1; i < userRows.length; i++) {
    if (userRows[i][1]) names[userRows[i][1]] = true;
  }
  var entriesSheet = getOrCreateSheet_(TIME_ENTRIES_SHEET,
    ['Timestamp', 'Date', 'SlackUserID', 'SlackUserName', 'Project', 'Hours', 'Note']);
  var entryRows = entriesSheet.getDataRange().getValues();
  for (var i = 1; i < entryRows.length; i++) {
    if (entryRows[i][3]) names[entryRows[i][3]] = true;
  }
  return Object.keys(names).sort();
}

function formatDate_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(value);
}

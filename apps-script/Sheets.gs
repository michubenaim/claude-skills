/**
 * All Google Sheets read/write logic. Sheet tabs:
 *
 * Projects     | ProjectName | SlackChannel | Active | BudgetHours
 * TimeEntries  | Timestamp | Date | SlackUserID | SlackUserName | Project | Hours | Note
 * Users        | SlackUserID | SlackUserName | IncludeInReminders
 *
 * Projects and Users are edited by a human admin (Active / IncludeInReminders
 * columns). BudgetHours is optional -- leave it blank for an uncapped
 * project. TimeEntries is append-only, written by the bot. A MonthlyTally
 * tab (created once, manually) reads TimeEntries via QUERY formulas -- see
 * docs/SHEET_SCHEMA.md.
 */

var PROJECTS_SHEET = 'Projects';
var TIME_ENTRIES_SHEET = 'TimeEntries';
var USERS_SHEET = 'Users';
var PROJECTS_HEADERS = ['ProjectName', 'SlackChannel', 'Active', 'BudgetHours'];

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

// Returns every row in Projects (active or not) as
// { name, channel, active, budget } -- budget is a Number, or null if the
// BudgetHours cell is blank (meaning uncapped).
function getAllProjects_() {
  var sheet = getOrCreateSheet_(PROJECTS_SHEET, PROJECTS_HEADERS);
  var rows = sheet.getDataRange().getValues();
  var projects = [];
  for (var i = 1; i < rows.length; i++) {
    var name = rows[i][0];
    if (!name) continue;
    var active = rows[i][2];
    var budgetRaw = rows[i][3];
    projects.push({
      name: name,
      channel: rows[i][1],
      active: active === true || String(active).toUpperCase() === 'TRUE',
      budget: (budgetRaw === '' || budgetRaw === null || budgetRaw === undefined) ? null : Number(budgetRaw)
    });
  }
  return projects;
}

function getActiveProjects_() {
  return getAllProjects_().filter(function (p) { return p.active; });
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

function formatDate_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(value);
}

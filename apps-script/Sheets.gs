/**
 * All Google Sheets read/write logic. Sheet tabs:
 *
 * Projects     | ProjectName | SlackChannel | Active | BudgetHours | StartDate | EndDate | DeadlineAlerted | UsedHours | Archived
 * TimeEntries  | Timestamp | Date | SlackUserID | SlackUserName | Project | Hours | Note | Categories
 * Users        | SlackUserID | SlackUserName | IncludeInReminders
 *
 * Projects and Users are edited by a human admin (Active / IncludeInReminders
 * columns) -- or, for Active/Archived, via the /hours-projects Slack command
 * (see PROJECT_ADMIN_SLACK_IDS in Config.gs). BudgetHours, StartDate and
 * EndDate are all optional. DeadlineAlerted is written by the bot
 * (Triggers.gs) once it has posted a past-deadline warning for that
 * project, so it only fires once -- clear it back to FALSE to allow
 * another alert (e.g. after pushing EndDate out and it passes again).
 * UsedHours is a running total the bot maintains (see
 * incrementProjectUsedHours_) -- don't hand-edit it. Archived is separate
 * from Active: Active/inactive plus the date window governs whether a
 * project shows up in the daily modal; Archived governs whether it shows
 * up on the dashboard at all (default hidden once archived, with a
 * show-archived toggle). TimeEntries is append-only, written by the bot;
 * Categories is a comma-joined list of the activity tags selected for that
 * row (multiple allowed; "Other: <text>" when Other is picked with detail).
 * A MonthlyTally tab (created once, manually) reads TimeEntries via QUERY
 * formulas -- see docs/SHEET_SCHEMA.md.
 */

var PROJECTS_SHEET = 'Projects';
var TIME_ENTRIES_SHEET = 'TimeEntries';
var USERS_SHEET = 'Users';
var PROJECTS_HEADERS = ['ProjectName', 'SlackChannel', 'Active', 'BudgetHours', 'StartDate', 'EndDate', 'DeadlineAlerted', 'UsedHours', 'Archived'];
var PROJECTS_USED_HOURS_COL_ = 8; // 1-indexed -- keep in sync with PROJECTS_HEADERS position
var PROJECTS_ARCHIVED_COL_ = 9; // 1-indexed -- keep in sync with PROJECTS_HEADERS position
var TIME_ENTRIES_HEADERS = ['Timestamp', 'Date', 'SlackUserID', 'SlackUserName', 'Project', 'Hours', 'Note', 'Categories'];

// Cached for the lifetime of a single execution only (Apps Script does not
// persist globals between separate requests) -- avoids re-opening the
// Spreadsheet on every getOrCreateSheet_ call within one request, which
// otherwise adds up when a single command touches multiple tabs.
var SHEETS_SPREADSHEET_CACHE_ = null;
function getSpreadsheet_() {
  if (!SHEETS_SPREADSHEET_CACHE_) {
    SHEETS_SPREADSHEET_CACHE_ = SpreadsheetApp.openById(getSpreadsheetId_());
  }
  return SHEETS_SPREADSHEET_CACHE_;
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
// startDate, endDate, overdue, archived }. `active` folds together the
// manual Active checkbox AND the StartDate/EndDate window: a project with
// Active=TRUE but a StartDate in the future, or an EndDate that's passed,
// comes back active:false -- so a project auto-retires on its EndDate
// without anyone having to remember to flip the checkbox. `overdue` is
// true once EndDate has passed, independent of `active`, so callers can
// flag it even though it's no longer showing in the daily modal.
// `archived` is independent of `active`/the date window -- it's a
// separate "hide from the dashboard entirely" flag, toggled via
// /hours-projects or the Archived column directly. startDate/endDate are
// Date objects or null (EndDate is optional -- leave it blank for an
// ongoing project with no deadline). budget is a Number, or null if
// BudgetHours is blank (uncapped).
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
    var archivedFlag = rows[i][PROJECTS_ARCHIVED_COL_ - 1];
    var overdue = !!endDate && today > endOfDay_(endDate);
    var withinWindow = (!startDate || today >= startDate) && !overdue;
    var archived = archivedFlag === true || String(archivedFlag).toUpperCase() === 'TRUE';
    var rawActive = activeFlag === true || String(activeFlag).toUpperCase() === 'TRUE';

    projects.push({
      name: name,
      channel: rows[i][1],
      active: rawActive && withinWindow && !archived,
      rawActive: rawActive, // the literal Active checkbox, ignoring dates/archived -- toggle against this, not `active`
      budget: (budgetRaw === '' || budgetRaw === null || budgetRaw === undefined) ? null : Number(budgetRaw),
      startDate: startDate,
      endDate: endDate,
      overdue: overdue,
      archived: archived
    });
  }
  return projects;
}

function getActiveProjects_() {
  return getAllProjects_().filter(function (p) { return p.active; });
}

// Toggles a single boolean flag cell for a project (Active or Archived).
// Returns true if the project was found and updated, false otherwise.
function setProjectFlag_(projectName, columnIndex1Based, value) {
  var sheet = getOrCreateSheet_(PROJECTS_SHEET, PROJECTS_HEADERS);
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] === projectName) {
      sheet.getRange(i + 1, columnIndex1Based).setValue(value);
      return true;
    }
  }
  return false;
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

// projectNotes and projectCategories are both { projectName: string }, one
// per project (not one shared value for the whole submission) -- they only
// get attached to a project's row if that project actually has nonzero
// hours this submission. projectCategories values are already a
// comma-joined tag string (see formatCategoriesForStorage_ in Modals.gs).
function appendTimeEntries_(userId, userName, dateStr, projectHours, projectNotes, projectCategories) {
  var sheet = getOrCreateSheet_(TIME_ENTRIES_SHEET, TIME_ENTRIES_HEADERS);
  var now = new Date();
  var rows = [];
  Object.keys(projectHours).forEach(function (project) {
    var hours = projectHours[project];
    if (hours > 0) {
      rows.push([
        now, dateStr, userId, userName, project, hours,
        (projectNotes && projectNotes[project]) || '',
        (projectCategories && projectCategories[project]) || ''
      ]);
    }
  });
  if (rows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    rows.forEach(function (row) { incrementProjectUsedHours_(row[4], row[5]); });
  }
  return rows.length;
}

// Bumps a single project's running UsedHours total in the Projects sheet by
// deltaHours. Projects is small (dozens of rows at most) so this full read
// is cheap, unlike scanning the ever-growing TimeEntries sheet. No-op if
// the project isn't found (e.g. hours logged for a project row that's
// since been renamed or deleted).
function incrementProjectUsedHours_(projectName, deltaHours) {
  var sheet = getOrCreateSheet_(PROJECTS_SHEET, PROJECTS_HEADERS);
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] === projectName) {
      var current = Number(rows[i][PROJECTS_USED_HOURS_COL_ - 1]) || 0;
      sheet.getRange(i + 1, PROJECTS_USED_HOURS_COL_).setValue(current + deltaHours);
      return;
    }
  }
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

// Returns { slackUserId: true } for everyone who logged at least one
// TimeEntries row on the given date -- used by the 9am missed-entry check
// (Triggers.gs) to find who to leave alone vs. who to nudge.
function getUserIdsWithEntriesOnDate_(dateStr) {
  var sheet = getOrCreateSheet_(TIME_ENTRIES_SHEET,
    TIME_ENTRIES_HEADERS);
  var rows = sheet.getDataRange().getValues();
  var ids = {};
  for (var i = 1; i < rows.length; i++) {
    if (formatDate_(rows[i][1]) === dateStr) ids[rows[i][2]] = true;
  }
  return ids;
}

// Returns { userName: { projectName: totalHours, ... }, ... } for entries
// whose Date (YYYY-MM-DD) falls in the given month (YYYY-MM).
function computeMonthlyTally_(monthStr) {
  var sheet = getOrCreateSheet_(TIME_ENTRIES_SHEET,
    TIME_ENTRIES_HEADERS);
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

// Returns { projectName: totalHoursEverLogged }, read from the Projects
// sheet's UsedHours column (kept current by incrementProjectUsedHours_ on
// every submission) -- O(number of projects), not O(size of TimeEntries).
// This is on the hot path for /log-hours (Slack allows only ~3 seconds to
// respond), so it must stay cheap regardless of how large TimeEntries
// grows. See computeProjectTotalsFromEntries_ for the full-scan version
// used only to (re)populate this column.
function getProjectTotalsAllTime_() {
  var sheet = getOrCreateSheet_(PROJECTS_SHEET, PROJECTS_HEADERS);
  var rows = sheet.getDataRange().getValues();
  var totals = {};
  for (var i = 1; i < rows.length; i++) {
    var name = rows[i][0];
    if (!name) continue;
    totals[name] = Number(rows[i][PROJECTS_USED_HOURS_COL_ - 1]) || 0;
  }
  return totals;
}

// The original full TimeEntries scan getProjectTotalsAllTime_ used to do.
// Kept only for backfillProjectUsedHours_ (the one-time migration/resync
// function) -- never call this from a Slack-response code path.
function computeProjectTotalsFromEntries_() {
  var sheet = getOrCreateSheet_(TIME_ENTRIES_SHEET,
    TIME_ENTRIES_HEADERS);
  var rows = sheet.getDataRange().getValues();
  var totals = {};
  for (var i = 1; i < rows.length; i++) {
    var project = rows[i][4];
    var hours = Number(rows[i][5]) || 0;
    totals[project] = (totals[project] || 0) + hours;
  }
  return totals;
}

// One-time (or safe-to-rerun) migration: recomputes UsedHours for every
// project from the full TimeEntries history and writes it into the
// Projects sheet, adding the UsedHours header if it isn't there yet. Run
// this once after deploying the UsedHours column, and again any time you
// suspect the running total has drifted (e.g. after manually editing
// TimeEntries).
function backfillProjectUsedHours_() {
  var sheet = getOrCreateSheet_(PROJECTS_SHEET, PROJECTS_HEADERS);
  if (String(sheet.getRange(1, PROJECTS_USED_HOURS_COL_).getValue()) !== 'UsedHours') {
    sheet.getRange(1, PROJECTS_USED_HOURS_COL_).setValue('UsedHours');
  }
  var totals = computeProjectTotalsFromEntries_();
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    var name = rows[i][0];
    if (!name) continue;
    sheet.getRange(i + 1, PROJECTS_USED_HOURS_COL_).setValue(totals[name] || 0);
  }
  Logger.log('Backfilled UsedHours for ' + (rows.length - 1) + ' project row(s).');
}

// One-time (safe-to-rerun) migration: adds the Archived header to Projects
// and the Categories header to TimeEntries if either sheet was created
// before those columns existed. Both new columns are fine left blank for
// existing rows (blank Archived = not archived, blank Categories = no
// tags recorded for that historical entry), so there's no data to backfill
// here -- just the header cells.
function ensureSchemaColumns_() {
  var projectsSheet = getOrCreateSheet_(PROJECTS_SHEET, PROJECTS_HEADERS);
  if (String(projectsSheet.getRange(1, PROJECTS_ARCHIVED_COL_).getValue()) !== 'Archived') {
    projectsSheet.getRange(1, PROJECTS_ARCHIVED_COL_).setValue('Archived');
  }

  var entriesSheet = getOrCreateSheet_(TIME_ENTRIES_SHEET, TIME_ENTRIES_HEADERS);
  var categoriesCol = TIME_ENTRIES_HEADERS.length; // last column, 1-indexed since length == last index + 1
  if (String(entriesSheet.getRange(1, categoriesCol).getValue()) !== 'Categories') {
    entriesSheet.getRange(1, categoriesCol).setValue('Categories');
  }

  Logger.log('Schema columns ensured: Projects.Archived, TimeEntries.Categories.');
}

// Returns { projectName: hoursLoggedStrictlyBeforeThisMonth }. Used to
// compute a project's budget balance as of the start of a given month
// (budget - this), separate from what gets logged during the month itself.
function getProjectUsedBeforeMonth_(monthStr) {
  return getProjectTotalsBeforeDate_(monthStr + '-01');
}

// Returns { projectName: hoursLoggedStrictlyBeforeCutoffDate }, cutoffDateStr
// exclusive. General-purpose version of getProjectUsedBeforeMonth_, used by
// the dashboard's burn-down chart to establish each project's running total
// as of an arbitrary range start.
function getProjectTotalsBeforeDate_(cutoffDateStr) {
  var sheet = getOrCreateSheet_(TIME_ENTRIES_SHEET,
    TIME_ENTRIES_HEADERS);
  var rows = sheet.getDataRange().getValues();
  var totals = {};
  for (var i = 1; i < rows.length; i++) {
    var dateStr = formatDate_(rows[i][1]);
    if (dateStr >= cutoffDateStr) continue;
    var project = rows[i][4];
    var hours = Number(rows[i][5]) || 0;
    totals[project] = (totals[project] || 0) + hours;
  }
  return totals;
}

// Returns every TimeEntries row whose Date falls within [startDateStr,
// endDateStr] (inclusive) as { date, userId, userName, project, hours,
// note, categories } objects -- the single source the dashboard's
// range-based views all derive from (see Analytics.gs). `categories` is
// the raw comma-joined tag string as stored (possibly empty).
function getEntriesInRange_(startDateStr, endDateStr) {
  var sheet = getOrCreateSheet_(TIME_ENTRIES_SHEET,
    TIME_ENTRIES_HEADERS);
  var rows = sheet.getDataRange().getValues();
  var entries = [];
  for (var i = 1; i < rows.length; i++) {
    var dateStr = formatDate_(rows[i][1]);
    if (dateStr < startDateStr || dateStr > endDateStr) continue;
    entries.push({
      date: dateStr,
      userId: rows[i][2],
      userName: rows[i][3],
      project: rows[i][4],
      hours: Number(rows[i][5]) || 0,
      note: rows[i][6] || '',
      categories: rows[i][7] || ''
    });
  }
  return entries;
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
    TIME_ENTRIES_HEADERS);
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

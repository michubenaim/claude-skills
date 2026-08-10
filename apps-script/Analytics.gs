/**
 * Pure data-shaping for the dashboard: resolving a timeframe preset into
 * actual dates, tallying entries, classifying project status, and building
 * the series the burn-down chart draws. No Slack/HTML concerns live here --
 * see Dashboard.gs for the client-facing glue.
 */

// preset is 'week' | 'month' | 'quarter' | 'year' | 'custom'. 'week' (the
// default) is Monday-of-this-week through today. Every preset's end is
// today -- these are all "to date" windows, not full calendar periods.
function resolveRange_(preset, customStart, customEnd) {
  var tz = Session.getScriptTimeZone();
  var today = new Date();
  var todayStr = Utilities.formatDate(today, tz, 'yyyy-MM-dd');

  if (preset === 'custom' && customStart && customEnd) {
    return { start: customStart, end: customEnd, label: customStart + ' – ' + customEnd };
  }
  if (preset === 'month') {
    var start = new Date(today.getFullYear(), today.getMonth(), 1);
    return { start: Utilities.formatDate(start, tz, 'yyyy-MM-dd'), end: todayStr, label: 'This month' };
  }
  if (preset === 'quarter') {
    var qStartMonth = Math.floor(today.getMonth() / 3) * 3;
    var start = new Date(today.getFullYear(), qStartMonth, 1);
    return { start: Utilities.formatDate(start, tz, 'yyyy-MM-dd'), end: todayStr, label: 'This quarter' };
  }
  if (preset === 'year') {
    var start = new Date(today.getFullYear(), 0, 1);
    return { start: Utilities.formatDate(start, tz, 'yyyy-MM-dd'), end: todayStr, label: 'This year' };
  }

  var monday = mondayOfWeek_(today);
  return { start: Utilities.formatDate(monday, tz, 'yyyy-MM-dd'), end: todayStr, label: 'Week to date' };
}

function mondayOfWeek_(date) {
  var d = new Date(date);
  var day = d.getDay(); // 0=Sun..6=Sat
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d;
}

function enumerateDates_(startDateStr, endDateStr) {
  var dates = [];
  var cur = parseSheetDate_(startDateStr);
  var end = parseSheetDate_(endDateStr);
  while (cur <= end) {
    dates.push(Utilities.formatDate(cur, Session.getScriptTimeZone(), 'yyyy-MM-dd'));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

// entries: getEntriesInRange_() rows. Returns { personName: { project: hours } }.
function tallyPersonProject_(entries) {
  var t = {};
  entries.forEach(function (e) {
    if (!t[e.userName]) t[e.userName] = {};
    t[e.userName][e.project] = (t[e.userName][e.project] || 0) + e.hours;
  });
  return t;
}

// Projects ranked by hours logged within the range, most first -- "where
// are hours actually going right now."
function rankProjectsByHours_(entries) {
  var totals = {};
  entries.forEach(function (e) { totals[e.project] = (totals[e.project] || 0) + e.hours; });
  return Object.keys(totals)
    .map(function (p) { return { project: p, hours: totals[p] }; })
    .sort(function (a, b) { return b.hours - a.hours; });
}

// { projectName: [{ date, cumulative }, ...] } across every day in the
// range, for the burn-down chart. `cumulative` is the ALL-TIME running
// total through that day (baseline-before-range + range-to-date), since
// BudgetHours is a lifetime allocation, not scoped to the selected window.
function buildBurndownSeries_(entries, projects, rangeStart, rangeEnd) {
  var baseline = getProjectTotalsBeforeDate_(rangeStart);
  var byProjectByDate = {};
  entries.forEach(function (e) {
    if (!byProjectByDate[e.project]) byProjectByDate[e.project] = {};
    byProjectByDate[e.project][e.date] = (byProjectByDate[e.project][e.date] || 0) + e.hours;
  });

  var dateList = enumerateDates_(rangeStart, rangeEnd);
  var series = {};
  projects.forEach(function (p) {
    var running = baseline[p.name] || 0;
    series[p.name] = dateList.map(function (d) {
      running += (byProjectByDate[p.name] && byProjectByDate[p.name][d]) || 0;
      return { date: d, cumulative: running };
    });
  });
  return series;
}

// Two independent, orthogonal facts about a project -- how its budget is
// holding up, and how its schedule is holding up -- rather than one
// conflated status, since a project can be over budget but on schedule (or
// vice versa).
//
// budgetStatus:
//   'uncapped'    no BudgetHours set
//   'over_budget' usedAllTime > budget
//   'at_risk'     spending faster than the project's elapsed-time fraction
//                 warrants (needs both StartDate and EndDate to compare
//                 against), or, lacking dates, already at/above 90% used
//   'on_track'    neither of the above
//
// scheduleStatus:
//   'no_deadline' no EndDate set
//   'late'        EndDate has passed (see getAllProjects_'s `overdue`)
//   'on_schedule' EndDate set and not yet passed
//
// The 15-percentage-point "at risk" margin is a heuristic, not a hard rule
// -- adjust ANALYTICS_AT_RISK_MARGIN_ below if it's too sensitive/lax.
var ANALYTICS_AT_RISK_MARGIN_ = 0.15;

function classifyProjectStatus_(project, usedAllTime) {
  var budgetStatus, budgetPct = null;

  if (project.budget != null && project.budget > 0) {
    budgetPct = usedAllTime / project.budget;
    if (usedAllTime > project.budget) {
      budgetStatus = 'over_budget';
    } else if (project.startDate && project.endDate) {
      var totalSpan = project.endDate.getTime() - project.startDate.getTime();
      var elapsed = Date.now() - project.startDate.getTime();
      var pctElapsed = totalSpan > 0 ? Math.max(0, Math.min(1, elapsed / totalSpan)) : 1;
      budgetStatus = (budgetPct - pctElapsed > ANALYTICS_AT_RISK_MARGIN_) ? 'at_risk' : 'on_track';
    } else {
      budgetStatus = budgetPct >= 0.9 ? 'at_risk' : 'on_track';
    }
  } else {
    budgetStatus = 'uncapped';
  }

  var scheduleStatus = project.overdue ? 'late' : (project.endDate ? 'on_schedule' : 'no_deadline');

  return { budgetStatus: budgetStatus, scheduleStatus: scheduleStatus, budgetPct: budgetPct };
}

// Projects as returned by getAllProjects_() carry real Date objects, which
// don't round-trip cleanly through google.script.run -- flatten to strings
// before sending to the client.
function projectsForClient_(projects) {
  return projects.map(function (p) {
    return {
      name: p.name,
      active: p.active,
      overdue: p.overdue,
      budget: p.budget,
      startDate: p.startDate ? formatDate_(p.startDate) : null,
      endDate: p.endDate ? formatDate_(p.endDate) : null
    };
  });
}

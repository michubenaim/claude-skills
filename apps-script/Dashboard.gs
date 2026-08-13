/**
 * Interactive HTML dashboard: a timeframe toggle (week/month/quarter/year/
 * custom) drives project status cards, a "where hours are going" ranking
 * chart, a per-project burn-down chart, by-project/by-person tables, and a
 * per-project person-share breakdown -- plus an "Export to Sheet" button.
 * Served by doGet (Code.gs) only on the dashboard deployment (Execute as:
 * User accessing the web app) -- see docs/SETUP.md. Access is gated by
 * DASHBOARD_ALLOWED_EMAILS regardless of which Google account signs in,
 * since "Execute as: User accessing the web app" + "Anyone" access means
 * any Google account can reach doGet, not just people you've approved.
 *
 * The page itself is a static shell (renderDashboard_/buildDashboardShellHtml_);
 * all data comes from dashboardFetchData(), called via google.script.run
 * from client-side JS so the timeframe toggle can re-fetch without a full
 * page reload. dashboardExport() writes the current range's raw entries to
 * an "Export" sheet tab.
 */

function isDashboardViewerAllowed_(email) {
  email = (email || '').toLowerCase();
  var allowed = getDashboardAllowedEmails_();
  return allowed.some(function (entry) {
    return entry.indexOf('@') === 0 ? email.endsWith(entry) : email === entry;
  });
}

function renderDashboard_(email) {
  if (!isDashboardViewerAllowed_(email)) {
    return HtmlService.createHtmlOutput(
      '<p style="font-family:sans-serif;padding:2rem;">Signed in as ' + escapeHtml_(email) +
      ', but this account isn\'t on the dashboard allowlist. Ask an admin to add it to the ' +
      'DASHBOARD_ALLOWED_EMAILS script property.</p>'
    );
  }

  return HtmlService.createHtmlOutput(buildDashboardShellHtml_())
    .setTitle('Hours Tracker Dashboard')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ---- google.script.run entry points (called from client JS below) ----

// filterPayload: { preset, start, end, person, project, includeArchived }.
// person/project/includeArchived are all optional -- omitted means
// unfiltered (person/project) or archived-excluded (includeArchived).
function dashboardFetchData(filterPayload) {
  var email = Session.getActiveUser().getEmail();
  if (!isDashboardViewerAllowed_(email)) return { error: 'not_allowed' };

  var range = resolveRange_(filterPayload && filterPayload.preset, filterPayload && filterPayload.start, filterPayload && filterPayload.end);
  var entries = applyEntryFilters_(getEntriesInRange_(range.start, range.end), filterPayload);
  var projects = resolveDashboardProjects_(filterPayload);
  var totalsAllTime = getProjectTotalsAllTime_();

  var byPerson = tallyPersonProject_(entries);
  var byProject = transposeTally_(byPerson);
  var personNames = Object.keys(byPerson).sort();
  var projectNames = projects.map(function (p) { return p.name; });

  var statuses = {};
  projects.forEach(function (p) { statuses[p.name] = classifyProjectStatus_(p, totalsAllTime[p.name] || 0); });

  return {
    range: range,
    projects: projectsForClient_(projects),
    // Filter dropdown options -- independent of the current filters/range,
    // so switching person/project doesn't shrink the other dropdown's choices.
    allPersonNames: getAllKnownUserNames_(),
    allProjectNames: getAllProjects_().map(function (p) { return p.name; }),
    totalsAllTime: totalsAllTime,
    statuses: statuses,
    ranking: rankProjectsByHours_(entries),
    categoryRanking: rankCategoriesByHours_(entries),
    burndown: buildBurndownSeries_(entries, projects, range.start, range.end),
    byProjectTable: buildMatrixTable_(byProject, projectNames, personNames, 'Project', 'No hours logged in this range.'),
    byPersonTable: buildMatrixTable_(byPerson, personNames, projectNames, 'Person', 'No hours logged in this range.'),
    shareHtml: buildShareHtml_(byProject)
  };
}

function dashboardExport(filterPayload) {
  var email = Session.getActiveUser().getEmail();
  if (!isDashboardViewerAllowed_(email)) return { error: 'not_allowed' };

  var range = resolveRange_(filterPayload && filterPayload.preset, filterPayload && filterPayload.start, filterPayload && filterPayload.end);
  var entries = applyEntryFilters_(getEntriesInRange_(range.start, range.end), filterPayload);

  var sheet = getOrCreateSheet_('Export', ['Date', 'Person', 'Project', 'Hours', 'Note', 'Categories']);
  sheet.clearContents();
  sheet.appendRow(['Date', 'Person', 'Project', 'Hours', 'Note', 'Categories']);
  if (entries.length > 0) {
    var rows = entries.map(function (e) { return [e.date, e.userName, e.project, e.hours, e.note, e.categories]; });
    sheet.getRange(2, 1, rows.length, 6).setValues(rows);
  }
  return { ok: true, rows: entries.length, range: range };
}

// ---- server-rendered HTML fragments ----

function buildShareHtml_(byProject) {
  var projectNames = Object.keys(byProject).sort();
  if (projectNames.length === 0) return '<p class="empty">No hours logged in this range.</p>';

  return projectNames.map(function (projectName) {
    var people = byProject[projectName];
    var total = Object.keys(people).reduce(function (sum, k) { return sum + people[k]; }, 0);
    var rows = Object.keys(people)
      .sort(function (a, b) { return people[b] - people[a]; })
      .map(function (person) {
        var hours = people[person];
        var pct = total > 0 ? Math.round((hours / total) * 100) : 0;
        return '<div class="share-row">' +
          '<span class="share-name">' + escapeHtml_(person) + '</span>' +
          '<div class="share-bar"><div class="share-bar-fill" style="width:' + pct + '%;"></div></div>' +
          '<span class="share-pct">' + hours.toFixed(1) + 'h &middot; ' + pct + '%</span>' +
          '</div>';
      }).join('');
    return '<div class="share-project"><h3>' + escapeHtml_(projectName) + '</h3>' + rows + '</div>';
  }).join('');
}

// data is { rowKey: { colKey: hours } }. Renders rowLabel | col1 | col2 | ... | Total.
function buildMatrixTable_(data, rowKeys, colKeys, rowLabel, emptyMessage) {
  var head = '<th>' + escapeHtml_(rowLabel) + '</th>' + colKeys.map(function (c) {
    return '<th>' + escapeHtml_(c) + '</th>';
  }).join('') + '<th>Total</th>';

  var rows = rowKeys.map(function (rowKey) {
    var row = data[rowKey] || {};
    var total = 0;
    var cells = colKeys.map(function (colKey) {
      var hours = row[colKey] || 0;
      total += hours;
      return '<td>' + (hours ? hours.toFixed(1) : '&ndash;') + '</td>';
    }).join('');
    return '<tr><td class="row-label">' + escapeHtml_(rowKey) + '</td>' + cells + '<td class="total">' + total.toFixed(1) + '</td></tr>';
  }).join('');

  if (rowKeys.length === 0) {
    rows = '<tr><td colspan="' + (colKeys.length + 2) + '" class="empty">' + escapeHtml_(emptyMessage) + '</td></tr>';
  }

  return '<div class="table-wrap"><table><thead><tr>' + head + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
}

// { rowKey: { colKey: value } } -> { colKey: { rowKey: value } }
function transposeTally_(tally) {
  var result = {};
  Object.keys(tally).forEach(function (rowKey) {
    Object.keys(tally[rowKey]).forEach(function (colKey) {
      if (!result[colKey]) result[colKey] = {};
      result[colKey][rowKey] = tally[rowKey][colKey];
    });
  });
  return result;
}

function escapeHtml_(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---- the static page shell ----

function buildDashboardShellHtml_() {
  return '<!doctype html><html><head><meta charset="utf-8">' +
    '<style>' + DASHBOARD_CSS_ + '</style></head><body>' +
    '<main>' +
      '<header>' +
        '<div class="header-row">' +
          '<div><h1>Hours Tracker</h1><p class="sub" id="range-label">Loading…</p></div>' +
          '<button class="btn" id="export-btn" type="button">Export to Sheet</button>' +
        '</div>' +
        '<div class="toggle-bar">' +
          '<button class="range-btn active" data-preset="week" type="button">Week to date</button>' +
          '<button class="range-btn" data-preset="month" type="button">This month</button>' +
          '<button class="range-btn" data-preset="quarter" type="button">This quarter</button>' +
          '<button class="range-btn" data-preset="year" type="button">This year</button>' +
          '<button class="range-btn" data-preset="custom" type="button">Custom…</button>' +
        '</div>' +
        '<div class="custom-row" id="custom-row">' +
          '<input type="date" id="custom-start"> <span>to</span> <input type="date" id="custom-end">' +
          '<button class="btn btn-small" id="custom-apply" type="button">Apply</button>' +
        '</div>' +
        '<div class="filters-row">' +
          '<label>Person <select id="filter-person"><option value="">Everyone</option></select></label>' +
          '<label>Project <select id="filter-project"><option value="">All projects</option></select></label>' +
          '<label class="checkbox-label"><input type="checkbox" id="filter-archived"> Show archived</label>' +
        '</div>' +
        '<p class="status-msg" id="status-msg"></p>' +
      '</header>' +

      '<section><h2>Project status</h2><div class="cards" id="cards"></div></section>' +

      '<section><h2>Where hours are going</h2><div id="ranking-chart" class="chart"></div></section>' +

      '<section>' +
        '<h2>Burn-down <select id="burndown-project"></select></h2>' +
        '<div id="burndown-chart" class="chart"></div>' +
      '</section>' +

      '<section><h2>Hours by category</h2><div id="category-chart" class="chart"></div></section>' +

      '<section><h2>By project, by person</h2><div id="matrix-by-project"></div></section>' +
      '<section><h2>By person, by project</h2><div id="matrix-by-person"></div></section>' +

      '<section><h2>Who\'s spending time where</h2><div id="share-lists"></div></section>' +
    '</main>' +
    '<script src="https://www.gstatic.com/charts/loader.js"></script>' +
    '<script>' + DASHBOARD_CLIENT_JS_ + '</script>' +
  '</body></html>';
}

var DASHBOARD_CLIENT_JS_ = '' +
'google.charts.load("current", {packages: ["corechart", "bar"]});\n' +
'var dashState = { preset: "week", person: "", project: "", includeArchived: false };\n' +
'var dashLastData = null;\n' +
'\n' +
'document.addEventListener("DOMContentLoaded", function () {\n' +
'  document.querySelectorAll(".range-btn").forEach(function (btn) {\n' +
'    btn.addEventListener("click", function () {\n' +
'      document.querySelectorAll(".range-btn").forEach(function (b) { b.classList.remove("active"); });\n' +
'      btn.classList.add("active");\n' +
'      var preset = btn.getAttribute("data-preset");\n' +
'      var customRow = document.getElementById("custom-row");\n' +
'      dashState.preset = preset;\n' +
'      delete dashState.start;\n' +
'      delete dashState.end;\n' +
'      if (preset === "custom") {\n' +
'        customRow.classList.add("visible");\n' +
'      } else {\n' +
'        customRow.classList.remove("visible");\n' +
'        dashLoad();\n' +
'      }\n' +
'    });\n' +
'  });\n' +
'  document.getElementById("custom-apply").addEventListener("click", function () {\n' +
'    var start = document.getElementById("custom-start").value;\n' +
'    var end = document.getElementById("custom-end").value;\n' +
'    if (!start || !end) return;\n' +
'    dashState.preset = "custom";\n' +
'    dashState.start = start;\n' +
'    dashState.end = end;\n' +
'    dashLoad();\n' +
'  });\n' +
'  document.getElementById("filter-person").addEventListener("change", function (e) {\n' +
'    dashState.person = e.target.value;\n' +
'    dashLoad();\n' +
'  });\n' +
'  document.getElementById("filter-project").addEventListener("change", function (e) {\n' +
'    dashState.project = e.target.value;\n' +
'    dashLoad();\n' +
'  });\n' +
'  document.getElementById("filter-archived").addEventListener("change", function (e) {\n' +
'    dashState.includeArchived = e.target.checked;\n' +
'    dashLoad();\n' +
'  });\n' +
'  document.getElementById("export-btn").addEventListener("click", function () {\n' +
'    dashSetStatus("Exporting…");\n' +
'    google.script.run.withSuccessHandler(function (res) {\n' +
'      dashSetStatus(res && res.ok ? ("Exported " + res.rows + " rows to the \\"Export\\" tab.") : "Export failed.");\n' +
'    }).withFailureHandler(function (err) {\n' +
'      dashSetStatus("Export failed: " + err.message);\n' +
'    }).dashboardExport(dashState);\n' +
'  });\n' +
'  google.charts.setOnLoadCallback(function () { dashLoad(); });\n' +
'});\n' +
'\n' +
'function dashSetStatus(msg) { document.getElementById("status-msg").textContent = msg || ""; }\n' +
'\n' +
'function dashLoad() {\n' +
'  dashSetStatus("Loading…");\n' +
'  google.script.run.withSuccessHandler(function (data) {\n' +
'    if (data && data.error) { dashSetStatus("Not authorized."); return; }\n' +
'    dashSetStatus("");\n' +
'    dashRender(data);\n' +
'  }).withFailureHandler(function (err) {\n' +
'    dashSetStatus("Error: " + err.message);\n' +
'  }).dashboardFetchData(dashState);\n' +
'}\n' +
'\n' +
'function dashRender(data) {\n' +
'  dashLastData = data;\n' +
'  document.getElementById("range-label").textContent = data.range.label + " (" + data.range.start + " to " + data.range.end + ")";\n' +
'  dashRenderFilterOptions(data);\n' +
'  dashRenderCards(data);\n' +
'  dashRenderBarChart("ranking-chart", data.ranking.map(function (r) { return [r.project, r.hours]; }), "No hours logged in this range.");\n' +
'  dashRenderBurndownSelector(data);\n' +
'  dashRenderBarChart("category-chart", data.categoryRanking.map(function (r) { return [r.category, r.hours]; }), "No categories tagged in this range yet.");\n' +
'  document.getElementById("matrix-by-project").innerHTML = data.byProjectTable;\n' +
'  document.getElementById("matrix-by-person").innerHTML = data.byPersonTable;\n' +
'  document.getElementById("share-lists").innerHTML = data.shareHtml;\n' +
'}\n' +
'\n' +
'function dashFillSelect(select, options, currentValue, placeholderLabel) {\n' +
'  select.innerHTML = "";\n' +
'  var placeholder = document.createElement("option");\n' +
'  placeholder.value = ""; placeholder.textContent = placeholderLabel;\n' +
'  select.appendChild(placeholder);\n' +
'  options.forEach(function (name) {\n' +
'    var opt = document.createElement("option");\n' +
'    opt.value = name; opt.textContent = name;\n' +
'    select.appendChild(opt);\n' +
'  });\n' +
'  select.value = currentValue || "";\n' +
'}\n' +
'\n' +
'function dashRenderFilterOptions(data) {\n' +
'  dashFillSelect(document.getElementById("filter-person"), data.allPersonNames, dashState.person, "Everyone");\n' +
'  dashFillSelect(document.getElementById("filter-project"), data.allProjectNames, dashState.project, "All projects");\n' +
'  document.getElementById("filter-archived").checked = !!dashState.includeArchived;\n' +
'}\n' +
'\n' +
'function dashEscape(str) {\n' +
'  var div = document.createElement("div");\n' +
'  div.textContent = str == null ? "" : String(str);\n' +
'  return div.innerHTML;\n' +
'}\n' +
'\n' +
'var DASH_BADGE_LABELS = { over_budget: "Over budget", at_risk: "At risk", on_track: "On track", uncapped: "Uncapped", late: "Late", on_schedule: "On schedule", no_deadline: "No deadline" };\n' +
'var DASH_BADGE_CLASS = { over_budget: "bad", at_risk: "warn", on_track: "good", late: "bad", on_schedule: "good" };\n' +
'function dashBadge(key) {\n' +
'  if (!key) return "";\n' +
'  return "<span class=\\"badge badge-" + (DASH_BADGE_CLASS[key] || "neutral") + "\\">" + (DASH_BADGE_LABELS[key] || key) + "</span>";\n' +
'}\n' +
'\n' +
'function dashRenderCards(data) {\n' +
'  var container = document.getElementById("cards");\n' +
'  if (!data.projects.length) { container.innerHTML = "<p class=\\"empty\\">No projects match the current filters.</p>"; return; }\n' +
'  var rangeTotals = {};\n' +
'  data.ranking.forEach(function (r) { rangeTotals[r.project] = r.hours; });\n' +
'\n' +
'  container.innerHTML = data.projects.map(function (p) {\n' +
'    var status = data.statuses[p.name] || {};\n' +
'    var used = data.totalsAllTime[p.name] || 0;\n' +
'    var barHtml;\n' +
'    if (p.budget != null && p.budget > 0) {\n' +
'      var pct = Math.round((used / p.budget) * 100);\n' +
'      var color = status.budgetStatus === "over_budget" ? "var(--danger)" : (status.budgetStatus === "at_risk" ? "var(--warn)" : "var(--good)");\n' +
'      barHtml = "<div class=\\"bar\\"><div class=\\"bar-fill\\" style=\\"width:" + Math.min(pct, 100) + "%;background:" + color + ";\\"></div></div>" +\n' +
'        "<div class=\\"card-meta\\">" + used.toFixed(1) + "h / " + p.budget.toFixed(1) + "h &middot; " + pct + "%</div>";\n' +
'    } else {\n' +
'      barHtml = "<div class=\\"card-meta\\">" + used.toFixed(1) + "h logged all-time &middot; no budget set</div>";\n' +
'    }\n' +
'    var dates = (p.startDate || p.endDate) ? ("<div class=\\"card-dates\\">" + (p.startDate || "…") + " – " + (p.endDate || "ongoing") + "</div>") : "";\n' +
'    return "<div class=\\"card" + (p.active ? "" : " inactive") + "\\">" +\n' +
'      "<div class=\\"card-head\\"><span class=\\"card-name\\">" + dashEscape(p.name) + "</span>" +\n' +
'      "<div class=\\"badges\\">" + dashBadge(status.budgetStatus) + dashBadge(status.scheduleStatus) + (p.archived ? "<span class=\\"badge badge-neutral\\">Archived</span>" : "") + "</div></div>" +\n' +
'      barHtml +\n' +
'      "<div class=\\"card-meta\\">" + (rangeTotals[p.name] || 0).toFixed(1) + "h in this range</div>" +\n' +
'      dates +\n' +
'      "</div>";\n' +
'  }).join("");\n' +
'}\n' +
'\n' +
'function dashChartOptions(extra) {\n' +
'  var dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;\n' +
'  var axisColor = dark ? "#ababad" : "#616061";\n' +
'  var textColor = dark ? "#d1d2d3" : "#1d1c1d";\n' +
'  var base = {\n' +
'    backgroundColor: "transparent",\n' +
'    colors: ["#1264a3", "#e01e5a"],\n' +
'    titleTextStyle: { color: textColor },\n' +
'    hAxis: { textStyle: { color: axisColor }, titleTextStyle: { color: axisColor } },\n' +
'    vAxis: { textStyle: { color: axisColor }, titleTextStyle: { color: axisColor } },\n' +
'    legend: { textStyle: { color: textColor } },\n' +
'    chartArea: { width: "78%", height: "70%" }\n' +
'  };\n' +
'  extra = extra || {};\n' +
'  for (var k in extra) { base[k] = extra[k]; }\n' +
'  return base;\n' +
'}\n' +
'\n' +
'// rows: [[label, hours], ...], already sorted by the server.\n' +
'function dashRenderBarChart(elId, rows, emptyMessage) {\n' +
'  var el = document.getElementById(elId);\n' +
'  if (!rows.length) { el.innerHTML = "<p class=\\"empty\\">" + dashEscape(emptyMessage) + "</p>"; return; }\n' +
'  el.innerHTML = "";\n' +
'  var dt = new google.visualization.DataTable();\n' +
'  dt.addColumn("string", "Label");\n' +
'  dt.addColumn("number", "Hours");\n' +
'  dt.addRows(rows);\n' +
'  var chart = new google.visualization.BarChart(el);\n' +
'  chart.draw(dt, dashChartOptions({ legend: { position: "none" }, hAxis: { title: "Hours" }, height: Math.max(140, rows.length * 34) }));\n' +
'}\n' +
'\n' +
'function dashRenderBurndownSelector(data) {\n' +
'  var select = document.getElementById("burndown-project");\n' +
'  var current = select.value;\n' +
'  select.innerHTML = "";\n' +
'  data.projects.forEach(function (p) {\n' +
'    var opt = document.createElement("option");\n' +
'    opt.value = p.name; opt.textContent = p.name;\n' +
'    select.appendChild(opt);\n' +
'  });\n' +
'  select.onchange = function () { dashDrawBurndown(select.value); };\n' +
'  if (!data.projects.length) { document.getElementById("burndown-chart").innerHTML = "<p class=\\"empty\\">No projects match the current filters.</p>"; return; }\n' +
'  var target = (current && data.burndown[current]) ? current : data.projects[0].name;\n' +
'  select.value = target;\n' +
'  dashDrawBurndown(target);\n' +
'}\n' +
'\n' +
'function dashDrawBurndown(projectName) {\n' +
'  var el = document.getElementById("burndown-chart");\n' +
'  var series = (dashLastData.burndown && dashLastData.burndown[projectName]) || [];\n' +
'  var project = dashLastData.projects.filter(function (p) { return p.name === projectName; })[0];\n' +
'  if (!series.length) { el.innerHTML = "<p class=\\"empty\\">No data.</p>"; return; }\n' +
'  el.innerHTML = "";\n' +
'  var hasBudget = project && project.budget != null;\n' +
'  var dt = new google.visualization.DataTable();\n' +
'  dt.addColumn("date", "Date");\n' +
'  dt.addColumn("number", "Cumulative hours");\n' +
'  if (hasBudget) dt.addColumn("number", "Budget");\n' +
'  series.forEach(function (pt) {\n' +
'    var parts = pt.date.split("-");\n' +
'    var row = [new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])), pt.cumulative];\n' +
'    if (hasBudget) row.push(project.budget);\n' +
'    dt.addRow(row);\n' +
'  });\n' +
'  var chart = new google.visualization.LineChart(el);\n' +
'  chart.draw(dt, dashChartOptions({\n' +
'    series: hasBudget ? { 1: { lineDashStyle: [4, 4] } } : {},\n' +
'    hAxis: { format: "MMM d" },\n' +
'    height: 300\n' +
'  }));\n' +
'}\n';

var DASHBOARD_CSS_ = '' +
  ':root{--bg:#f3f2ef;--surface:#fff;--border:#e3e2df;--text:#1d1c1d;--text-soft:#616061;--good:#007a5a;--warn:#e8a33d;--danger:#e01e5a;--accent:#1264a3;}' +
  '@media (prefers-color-scheme:dark){:root{--bg:#0e1012;--surface:#1a1d21;--border:#34373b;--text:#d1d2d3;--text-soft:#ababad;--good:#1e9c73;--warn:#e8a33d;--danger:#f2528c;--accent:#4dabf5;}}' +
  '*{box-sizing:border-box;}' +
  'body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}' +
  'main{max-width:1040px;margin:0 auto;padding:32px 20px 64px;}' +
  'h1{margin:0 0 4px;font-size:22px;}' +
  '.header-row{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;}' +
  '.sub{margin:0;color:var(--text-soft);font-size:13px;}' +
  'h2{font-size:15px;margin:30px 0 12px;display:flex;align-items:center;gap:8px;}' +
  '.toggle-bar{display:flex;gap:6px;margin:16px 0 4px;flex-wrap:wrap;}' +
  '.range-btn{font:inherit;font-size:12.5px;font-weight:700;border:1px solid var(--border);background:var(--surface);color:var(--text-soft);border-radius:999px;padding:6px 14px;cursor:pointer;}' +
  '.range-btn.active{background:var(--accent);border-color:var(--accent);color:#fff;}' +
  '.custom-row{display:none;align-items:center;gap:8px;margin:10px 0 0;font-size:13px;color:var(--text-soft);}' +
  '.custom-row.visible{display:flex;}' +
  '.custom-row input{font:inherit;padding:5px 8px;border:1px solid var(--border);border-radius:5px;background:var(--surface);color:var(--text);}' +
  '.filters-row{display:flex;align-items:center;gap:16px;margin:14px 0 0;flex-wrap:wrap;font-size:12.5px;color:var(--text-soft);}' +
  '.filters-row label{display:flex;align-items:center;gap:6px;}' +
  '.checkbox-label{cursor:pointer;}' +
  '.status-msg{min-height:16px;font-size:12px;color:var(--text-soft);margin:10px 0 0;}' +
  '.btn{font:inherit;font-weight:700;font-size:13px;border-radius:6px;padding:8px 16px;cursor:pointer;background:var(--accent);border:1px solid var(--accent);color:#fff;}' +
  '.btn-small{padding:5px 12px;font-size:12px;}' +
  'select{font:inherit;font-size:12.5px;border:1px solid var(--border);border-radius:5px;padding:3px 8px;background:var(--surface);color:var(--text);}' +
  '.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px;}' +
  '.card{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:14px 16px;}' +
  '.card.inactive{opacity:0.55;}' +
  '.card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:10px;}' +
  '.card-name{font-weight:700;font-size:14px;}' +
  '.badges{display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;}' +
  '.badge{font-size:9.5px;text-transform:uppercase;letter-spacing:0.03em;border-radius:3px;padding:2px 6px;font-weight:800;white-space:nowrap;}' +
  '.badge-good{color:var(--good);background:color-mix(in srgb, var(--good) 15%, transparent);}' +
  '.badge-warn{color:var(--warn);background:color-mix(in srgb, var(--warn) 18%, transparent);}' +
  '.badge-bad{color:var(--danger);background:color-mix(in srgb, var(--danger) 15%, transparent);}' +
  '.badge-neutral{color:var(--text-soft);background:var(--bg);}' +
  '.bar{height:6px;border-radius:3px;background:var(--bg);overflow:hidden;margin-bottom:8px;}' +
  '.bar-fill{height:100%;border-radius:3px;}' +
  '.card-meta{font-size:12.5px;color:var(--text-soft);font-variant-numeric:tabular-nums;}' +
  '.card-dates{font-size:11.5px;color:var(--text-soft);margin-top:6px;}' +
  '.chart{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:8px;min-height:120px;}' +
  '.table-wrap{overflow-x:auto;border:1px solid var(--border);border-radius:8px;}' +
  'table{border-collapse:collapse;width:100%;font-size:13px;}' +
  'th,td{padding:8px 12px;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;}' +
  'th:first-child,td:first-child{text-align:left;}' +
  'thead th{background:var(--bg);color:var(--text-soft);font-weight:700;border-bottom:1px solid var(--border);}' +
  'tbody tr+tr td{border-top:1px solid var(--border);}' +
  '.row-label{font-weight:600;}' +
  '.total{font-weight:700;}' +
  '.empty{color:var(--text-soft);padding:16px;text-align:center;}' +
  '.share-project{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px 16px;margin-bottom:10px;}' +
  '.share-project h3{margin:0 0 8px;font-size:13px;}' +
  '.share-row{display:grid;grid-template-columns:110px 1fr 100px;align-items:center;gap:10px;font-size:12.5px;margin-bottom:6px;}' +
  '.share-name{color:var(--text);}' +
  '.share-bar{height:6px;border-radius:3px;background:var(--bg);overflow:hidden;}' +
  '.share-bar-fill{height:100%;border-radius:3px;background:var(--accent);}' +
  '.share-pct{color:var(--text-soft);text-align:right;font-variant-numeric:tabular-nums;}';

/**
 * Read-only HTML dashboard: project budget draw-down + current-month
 * per-person breakdown. Served by doGet (Code.gs) only on the dashboard
 * deployment (Execute as: User accessing the web app) -- see
 * docs/SETUP.md. Access is gated by DASHBOARD_ALLOWED_EMAILS regardless of
 * which Google account signs in, since "Execute as: User accessing the web
 * app" + "Anyone" access means any Google account can reach doGet, not just
 * people you've approved.
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

  var projects = getAllProjects_();
  var totalsAllTime = getProjectTotalsAllTime_();
  var monthStr = currentMonthStr_();
  var monthlyTally = computeMonthlyTally_(monthStr);

  return HtmlService.createHtmlOutput(buildDashboardHtml_(projects, totalsAllTime, monthStr, monthlyTally))
    .setTitle('Hours Tracker Dashboard')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function buildDashboardHtml_(projects, totalsAllTime, monthStr, monthlyTally) {
  var projectCards = projects.map(function (p) {
    var used = totalsAllTime[p.name] || 0;
    var hasBudget = p.budget != null && p.budget > 0;
    var pct = hasBudget ? Math.min(Math.round((used / p.budget) * 100), 999) : null;
    var barColor = pct === null ? '#8a8d91' : pct >= 100 ? '#e01e5a' : pct >= 90 ? '#e8a33d' : '#007a5a';
    var barWidth = pct === null ? 0 : Math.min(pct, 100);
    return '' +
      '<div class="card' + (p.active ? '' : ' inactive') + '">' +
        '<div class="card-head">' +
          '<span class="card-name">' + escapeHtml_(p.name) + '</span>' +
          (p.active ? '' : '<span class="pill">inactive</span>') +
        '</div>' +
        (hasBudget
          ? '<div class="bar"><div class="bar-fill" style="width:' + barWidth + '%;background:' + barColor + ';"></div></div>' +
            '<div class="card-meta">' + used.toFixed(1) + 'h / ' + p.budget.toFixed(1) + 'h &middot; ' + pct + '%</div>'
          : '<div class="card-meta">' + used.toFixed(1) + 'h logged &middot; no budget set</div>'
        ) +
        (formatDateRange_(p.startDate, p.endDate)
          ? '<div class="card-dates">' + formatDateRange_(p.startDate, p.endDate) + '</div>'
          : '') +
      '</div>';
  }).join('');

  var userNames = Object.keys(monthlyTally).sort();
  var projectNames = projects.map(function (p) { return p.name; });
  userNames.forEach(function (u) {
    Object.keys(monthlyTally[u]).forEach(function (p) {
      if (projectNames.indexOf(p) === -1) projectNames.push(p);
    });
  });

  var tableHead = '<th>Person</th>' + projectNames.map(function (p) {
    return '<th>' + escapeHtml_(p) + '</th>';
  }).join('') + '<th>Total</th>';

  var tableRows = userNames.map(function (userName) {
    var row = monthlyTally[userName];
    var total = 0;
    var cells = projectNames.map(function (p) {
      var hours = row[p] || 0;
      total += hours;
      return '<td>' + (hours ? hours.toFixed(1) : '&ndash;') + '</td>';
    }).join('');
    return '<tr><td class="person">' + escapeHtml_(userName) + '</td>' + cells + '<td class="total">' + total.toFixed(1) + '</td></tr>';
  }).join('');

  if (userNames.length === 0) {
    tableRows = '<tr><td colspan="' + (projectNames.length + 2) + '" class="empty">No hours logged yet this month.</td></tr>';
  }

  return '<!doctype html><html><head><meta charset="utf-8">' +
    '<style>' + DASHBOARD_CSS_ + '</style></head><body>' +
    '<main>' +
      '<header><h1>Hours Tracker</h1><p class="sub">Project budgets (all-time) and the ' + escapeHtml_(monthStr) + ' tally</p></header>' +
      '<section class="cards">' + (projectCards || '<p class="empty">No projects configured yet.</p>') + '</section>' +
      '<section>' +
        '<h2>' + escapeHtml_(monthStr) + ' by person</h2>' +
        '<div class="table-wrap"><table><thead><tr>' + tableHead + '</tr></thead><tbody>' + tableRows + '</tbody></table></div>' +
      '</section>' +
    '</main>' +
  '</body></html>';
}

function formatDateRange_(startDate, endDate) {
  if (!startDate && !endDate) return '';
  var fmt = function (d) { return Utilities.formatDate(d, Session.getScriptTimeZone(), 'MMM d, yyyy'); };
  if (startDate && endDate) return fmt(startDate) + ' – ' + fmt(endDate);
  if (startDate) return 'Starts ' + fmt(startDate);
  return 'Ends ' + fmt(endDate);
}

function escapeHtml_(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

var DASHBOARD_CSS_ = '' +
  ':root{--bg:#f3f2ef;--surface:#fff;--border:#e3e2df;--text:#1d1c1d;--text-soft:#616061;}' +
  '@media (prefers-color-scheme:dark){:root{--bg:#0e1012;--surface:#1a1d21;--border:#34373b;--text:#d1d2d3;--text-soft:#ababad;}}' +
  '*{box-sizing:border-box;}' +
  'body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}' +
  'main{max-width:960px;margin:0 auto;padding:40px 20px 64px;}' +
  'header h1{margin:0 0 4px;font-size:22px;}' +
  '.sub{margin:0 0 28px;color:var(--text-soft);font-size:14px;}' +
  'h2{font-size:16px;margin:32px 0 12px;}' +
  '.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;}' +
  '.card{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:14px 16px;}' +
  '.card.inactive{opacity:0.55;}' +
  '.card-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;}' +
  '.card-name{font-weight:700;font-size:14px;}' +
  '.pill{font-size:10px;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-soft);background:var(--bg);border-radius:3px;padding:2px 6px;}' +
  '.bar{height:6px;border-radius:3px;background:var(--bg);overflow:hidden;margin-bottom:8px;}' +
  '.bar-fill{height:100%;border-radius:3px;}' +
  '.card-meta{font-size:12.5px;color:var(--text-soft);font-variant-numeric:tabular-nums;}' +
  '.card-dates{font-size:11.5px;color:var(--text-soft);margin-top:6px;}' +
  '.table-wrap{overflow-x:auto;border:1px solid var(--border);border-radius:8px;}' +
  'table{border-collapse:collapse;width:100%;font-size:13px;}' +
  'th,td{padding:8px 12px;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;}' +
  'th:first-child,td:first-child{text-align:left;}' +
  'thead th{background:var(--bg);color:var(--text-soft);font-weight:700;border-bottom:1px solid var(--border);}' +
  'tbody tr+tr td{border-top:1px solid var(--border);}' +
  '.person{font-weight:600;}' +
  '.total{font-weight:700;}' +
  '.empty{color:var(--text-soft);padding:16px;text-align:center;}';

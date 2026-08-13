/**
 * HTTP entry points. Slack calls this URL for slash commands
 * (/log-hours, /hours-report) and for interactivity (button clicks,
 * modal submissions). See docs/SETUP.md for how the URL is wired up
 * in the Slack app config, including the ?secret= query param that
 * takes the place of header-based signature verification (Apps
 * Script cannot read request headers -- see SlackApi.gs).
 *
 * This same script also serves the dashboard (Dashboard.gs), but only on a
 * *second*, separately-configured deployment (Execute as: User accessing
 * the web app) -- see docs/SETUP.md. On the Slack deployment (Execute as:
 * Me, anonymous access) there is no signed-in user, so doGet just returns a
 * health-check string there instead.
 *
 * doGet also accepts ?action=<name>&secret=<SLACK_SHARED_SECRET> on the
 * Slack deployment to run a small allowlist of maintenance functions (see
 * ADMIN_ACTIONS_) without needing the Apps Script editor -- useful since
 * its function dropdown/execution log has been known to get stuck. Reuses
 * the existing shared secret; this doesn't widen the trust boundary since
 * that secret already fully authorizes writes via doPost.
 */

var ADMIN_ACTIONS_ = {
  backfillUsedHours: backfillProjectUsedHours_,
  ensureSchemaColumns: ensureSchemaColumns_
};

function doGet(e) {
  var action = e.parameter && e.parameter.action;
  if (action) {
    if (e.parameter.secret !== getSlackSharedSecret_()) {
      return ContentService.createTextOutput('Forbidden');
    }
    if (!ADMIN_ACTIONS_[action]) {
      return ContentService.createTextOutput('Unknown action: ' + action);
    }
    ADMIN_ACTIONS_[action]();
    return ContentService.createTextOutput('Ran ' + action + '. Check the target sheet to confirm.');
  }

  var email = Session.getActiveUser().getEmail();
  if (!email) {
    return ContentService.createTextOutput('Hours Tracker is running.');
  }
  return renderDashboard_(email);
}

function doPost(e) {
  if (!verifySlackRequest_(e)) {
    return ContentService.createTextOutput('Forbidden');
  }

  var params = e.parameter;

  if (params.payload) {
    return handleInteractivity_(JSON.parse(params.payload));
  }

  if (params.command === '/log-hours') {
    return handleLogHoursCommand_(params);
  }

  if (params.command === '/hours-report') {
    return handleHoursReportCommand_(params);
  }

  if (params.command === '/hours-projects') {
    return handleProjectsCommand_(params);
  }

  if (params.command === '/hours-dashboard') {
    return handleDashboardCommand_(params);
  }

  return ContentService.createTextOutput('');
}

function handleLogHoursCommand_(params) {
  var projects = getActiveProjects_();
  var totals = getProjectTotalsAllTime_();
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  slackOpenView_(params.trigger_id, buildLogHoursModal_(projects, today, totals));
  return ContentService.createTextOutput('');
}

function handleHoursReportCommand_(params) {
  var monthStr = (params.text || '').trim() || currentMonthStr_();
  var byProject = transposeTally_(computeMonthlyTally_(monthStr));
  var text = formatMonthProjectReport_(monthStr, getAllProjects_(), getAllKnownUserNames_(), byProject, getProjectUsedBeforeMonth_(monthStr));
  return jsonResponse_({ response_type: 'ephemeral', text: text });
}

function handleProjectsCommand_(params) {
  if (!isProjectAdmin_(params.user_id)) {
    return jsonResponse_({ response_type: 'ephemeral', text: "You don't have permission to manage projects. Ask an admin to add your Slack ID to PROJECT_ADMIN_SLACK_IDS." });
  }
  return jsonResponse_({ response_type: 'ephemeral', blocks: buildProjectsAdminBlocks_(getAllProjects_()) });
}

function handleDashboardCommand_(params) {
  return jsonResponse_({ response_type: 'ephemeral', blocks: buildDashboardLinkBlocks_(getDashboardUrl_()) });
}

function handleInteractivity_(payload) {
  if (payload.type === 'shortcut') {
    if (payload.callback_id === 'log_hours_shortcut') {
      var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
      slackOpenView_(payload.trigger_id, buildLogHoursModal_(getActiveProjects_(), today, getProjectTotalsAllTime_()));
    } else if (payload.callback_id === 'open_dashboard_shortcut') {
      slackOpenView_(payload.trigger_id, buildDashboardLinkModal_(getDashboardUrl_()));
    }
    return ContentService.createTextOutput('');
  }

  if (payload.type === 'block_actions') {
    var action = payload.actions && payload.actions[0];

    if (action && action.action_id === 'open_log_hours_modal') {
      var projects = getActiveProjects_();
      var totals = getProjectTotalsAllTime_();
      // The reminder button carries the date it's for (today for the
      // evening ping, the skipped day for the missed-entry nudge); fall
      // back to today if it's missing (e.g. a button from before this).
      var targetDate = action.value || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
      slackOpenView_(payload.trigger_id, buildLogHoursModal_(projects, targetDate, totals));
    } else if (action && (action.action_id === 'toggle_active' || action.action_id === 'toggle_archived')) {
      handleProjectToggle_(payload, action);
    }

    return ContentService.createTextOutput('');
  }

  if (payload.type === 'view_submission' && payload.view.callback_id === 'log_hours_submit') {
    var metadata = JSON.parse(payload.view.private_metadata);
    var values = payload.view.state.values;
    var projectHours = {};
    var projectNotes = {};
    var projectCategories = {};
    metadata.projects.forEach(function (project, i) {
      var raw = values['project_' + i] && values['project_' + i].hours && values['project_' + i].hours.value;
      projectHours[project] = raw ? Number(raw) : 0;
      var noteRaw = values['project_' + i + '_note'] && values['project_' + i + '_note'].value && values['project_' + i + '_note'].value.value;
      projectNotes[project] = noteRaw || '';
      projectCategories[project] = parseSubmittedCategories_(values, i);
    });

    var totalsBefore = getProjectTotalsAllTime_();
    appendTimeEntries_(payload.user.id, payload.user.name || payload.user.username, metadata.date, projectHours, projectNotes, projectCategories);

    var projectsByName = {};
    getAllProjects_().forEach(function (p) { projectsByName[p.name] = p; });
    checkAndPostBudgetWarnings_(projectHours, totalsBefore, projectsByName);

    return ContentService.createTextOutput(''); // empty 200 closes the modal
  }

  return ContentService.createTextOutput('');
}

// Handles a toggle_active/toggle_archived button click from /hours-projects.
// Re-checks admin permission (the button could in principle be replayed by
// someone else), flips the flag, then re-renders the same message in place
// via response_url so repeated clicks update one message instead of
// spamming new ones.
function handleProjectToggle_(payload, action) {
  if (!isProjectAdmin_(payload.user.id)) {
    slackRespondToUrl_(payload.response_url, { response_type: 'ephemeral', replace_original: false, text: "You don't have permission to manage projects." });
    return;
  }

  var projectName = action.value;
  var projects = getAllProjects_();
  var target = projects.filter(function (p) { return p.name === projectName; })[0];
  if (!target) return;

  if (action.action_id === 'toggle_active') {
    setProjectFlag_(projectName, 3, !target.rawActive);
  } else {
    setProjectFlag_(projectName, PROJECTS_ARCHIVED_COL_, !target.archived);
  }

  slackRespondToUrl_(payload.response_url, {
    response_type: 'ephemeral',
    replace_original: true,
    blocks: buildProjectsAdminBlocks_(getAllProjects_())
  });
}

// Reads the checkboxes + "Other" text field for project index i out of a
// view_submission's state.values, returning a comma-joined tag string
// ("Research, Other: brand refresh copy") for storage in TimeEntries.
function parseSubmittedCategories_(values, i) {
  var checkboxState = values['project_' + i + '_categories'] && values['project_' + i + '_categories'].value;
  var selected = ((checkboxState && checkboxState.selected_options) || []).map(function (o) { return o.value; });
  var otherRaw = values['project_' + i + '_other'] && values['project_' + i + '_other'].value && values['project_' + i + '_other'].value.value;

  if (selected.indexOf('Other') !== -1 && otherRaw) {
    selected = selected.map(function (c) { return c === 'Other' ? ('Other: ' + otherRaw) : c; });
  }

  return selected.join(', ');
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function currentMonthStr_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM');
}

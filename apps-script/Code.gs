/**
 * HTTP entry points. Slack calls this URL for slash commands
 * (/log-hours, /hours-report) and for interactivity (button clicks,
 * modal submissions). See docs/SETUP.md for how the URL is wired up
 * in the Slack app config, including the ?secret= query param that
 * takes the place of header-based signature verification (Apps
 * Script cannot read request headers -- see SlackApi.gs).
 */

function doGet(e) {
  return ContentService.createTextOutput('Hours Tracker is running.');
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

  return ContentService.createTextOutput('');
}

function handleLogHoursCommand_(params) {
  var projects = getActiveProjects_();
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  slackOpenView_(params.trigger_id, buildLogHoursModal_(projects, today));
  return ContentService.createTextOutput('');
}

function handleHoursReportCommand_(params) {
  var monthStr = (params.text || '').trim() || currentMonthStr_();
  var tally = computeMonthlyTally_(monthStr);
  var text = formatTallyMessage_(monthStr, tally);
  return jsonResponse_({ response_type: 'ephemeral', text: text });
}

function handleInteractivity_(payload) {
  if (payload.type === 'block_actions') {
    var action = payload.actions && payload.actions[0];
    if (action && action.action_id === 'open_log_hours_modal') {
      var projects = getActiveProjects_();
      var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
      slackOpenView_(payload.trigger_id, buildLogHoursModal_(projects, today));
    }
    return ContentService.createTextOutput('');
  }

  if (payload.type === 'view_submission' && payload.view.callback_id === 'log_hours_submit') {
    var metadata = JSON.parse(payload.view.private_metadata);
    var values = payload.view.state.values;
    var projectHours = {};
    metadata.projects.forEach(function (project, i) {
      var raw = values['project_' + i] && values['project_' + i].hours && values['project_' + i].hours.value;
      projectHours[project] = raw ? Number(raw) : 0;
    });
    var note = values.note && values.note.value && values.note.value.value;

    appendTimeEntries_(payload.user.id, payload.user.name || payload.user.username, metadata.date, projectHours, note);

    return ContentService.createTextOutput(''); // empty 200 closes the modal
  }

  return ContentService.createTextOutput('');
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function currentMonthStr_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM');
}

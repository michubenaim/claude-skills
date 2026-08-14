/**
 * Slack Block Kit view/message builders.
 */

// Activity tags selectable per project in the log-hours modal. Multiple
// may be checked; "Other" pairs with a free-text field (see
// buildLogHoursModal_ and parseSubmittedCategories_ in Code.gs).
var CATEGORY_OPTIONS_ = ['Research', 'Strat', 'Design', 'Mtgs/Rev (internal)', 'Client service', 'Admin', 'Other'];

// One number_input block per active project. Slack modals can't easily grow
// rows dynamically without extra round-trips, so v1 shows every active
// project and the user leaves the ones they didn't touch blank -- fine for
// a team with a handful of concurrent projects. See README for scaling notes.
//
// `projects` is an array of { name, budget } (budget may be null/uncapped).
// `totals` is { projectName: hoursLoggedSoFar }, used to show a remaining-
// balance hint next to budgeted projects.
function buildLogHoursModal_(projects, dateStr, totals) {
  totals = totals || {};
  var blocks = [
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: 'Logging hours for *' + dateStr + '*. Leave a project blank if you didn\'t work on it today.' }]
    },
    { type: 'divider' }
  ];

  if (projects.length === 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: ':warning: No active projects are configured yet. Ask an admin to add rows to the *Projects* sheet.' }
    });
  }

  projects.forEach(function (project, i) {
    var labelText = project.name;
    if (project.budget != null) {
      var remaining = project.budget - (totals[project.name] || 0);
      labelText += remaining < 0
        ? ' (' + Math.abs(remaining).toFixed(1) + 'h over budget)'
        : ' (' + remaining.toFixed(1) + 'h left)';
    }
    blocks.push({
      type: 'input',
      block_id: 'project_' + i,
      optional: true,
      label: { type: 'plain_text', text: labelText },
      element: {
        type: 'number_input',
        is_decimal_allowed: true,
        min_value: '0',
        max_value: '24',
        action_id: 'hours'
      }
    });
    // Note is per-project, not one shared note for the whole submission --
    // it only gets used (and only shows up in that project's TimeEntries
    // row) if hours were actually entered for this project.
    blocks.push({
      type: 'input',
      block_id: 'project_' + i + '_note',
      optional: true,
      label: { type: 'plain_text', text: 'Note for ' + project.name },
      element: { type: 'plain_text_input', action_id: 'value' }
    });
    // Internal (non-client) projects can opt out of the category detail via
    // RequiresCategories=FALSE on the Projects sheet -- skip both blocks
    // entirely rather than just hiding them, so nothing shows up in
    // private_metadata/state.values for parseSubmittedCategories_ to read.
    if (project.requiresCategories !== false) {
      blocks.push({
        type: 'input',
        block_id: 'project_' + i + '_categories',
        optional: true,
        label: { type: 'plain_text', text: 'Category for ' + project.name },
        element: {
          type: 'checkboxes',
          action_id: 'value',
          options: CATEGORY_OPTIONS_.map(function (c) {
            return { text: { type: 'plain_text', text: c }, value: c };
          })
        }
      });
      blocks.push({
        type: 'input',
        block_id: 'project_' + i + '_other',
        optional: true,
        label: { type: 'plain_text', text: 'If "Other," describe' },
        element: { type: 'plain_text_input', action_id: 'value' }
      });
    }
  });

  return {
    type: 'modal',
    callback_id: 'log_hours_submit',
    private_metadata: JSON.stringify({ date: dateStr, projects: projects.map(function (p) { return p.name; }) }),
    title: { type: 'plain_text', text: 'Log today\'s hours' },
    submit: { type: 'plain_text', text: 'Submit' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: blocks
  };
}

// dateStr is embedded as the button's `value` so handleInteractivity_ knows
// which date to open the modal for -- the evening reminder passes today's
// date, the missed-entry nudge (Triggers.gs) passes the date that was
// skipped, so clicking either always opens the modal pre-targeted at the
// right day instead of always defaulting to "today".
function buildReminderBlocks_(dateStr, text) {
  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: text }
    },
    {
      type: 'actions',
      elements: [{
        type: 'button',
        text: { type: 'plain_text', text: 'Log hours' },
        action_id: 'open_log_hours_modal',
        style: 'primary',
        value: dateStr
      }]
    }
  ];
}

// Ephemeral message body for /hours-projects: one section + a pair of
// toggle buttons per project. Buttons carry the project name as `value`
// and a fixed action_id (toggle_active / toggle_archived) -- the handler
// (Code.gs) flips the corresponding sheet flag and re-posts this same
// builder via response_url with replace_original so the message updates
// in place instead of piling up new messages per click.
function buildProjectsAdminBlocks_(projects) {
  if (projects.length === 0) {
    return [{ type: 'section', text: { type: 'mrkdwn', text: 'No projects configured yet. Add rows to the *Projects* sheet first.' } }];
  }

  var blocks = [
    { type: 'section', text: { type: 'mrkdwn', text: '*Manage projects*' } },
    { type: 'divider' }
  ];

  projects.forEach(function (p) {
    // Status reflects the raw Active checkbox (what the button below
    // actually toggles); a separate note flags when it's checked on but
    // not currently showing in the modal anyway due to StartDate/EndDate.
    var status = [p.rawActive ? ':large_green_circle: Active' : ':white_circle: Inactive'];
    if (p.rawActive && !p.active && !p.archived) status.push('(outside its date window right now)');
    if (p.archived) status.push(':package: Archived (hidden from dashboard)');

    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '*' + p.name + '*\n' + status.join(' · ') }
    });
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: p.rawActive ? 'Deactivate' : 'Activate' },
          action_id: 'toggle_active',
          value: p.name
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: p.archived ? 'Unarchive' : 'Archive' },
          action_id: 'toggle_archived',
          value: p.name
        }
      ]
    });
    blocks.push({ type: 'divider' });
  });

  return blocks;
}

// A single "open the dashboard" link button. Buttons with a `url` (rather
// than relying on action_id handling) just open the link client-side --
// no server round-trip needed, so this works identically whether it's
// dropped into an ephemeral message (/hours-dashboard) or a modal (the
// "Open dashboard" global shortcut).
function buildDashboardLinkBlocks_(dashboardUrl) {
  return [
    { type: 'section', text: { type: 'mrkdwn', text: ':bar_chart: Your Hours Tracker dashboard:' } },
    {
      type: 'actions',
      elements: [{
        type: 'button',
        text: { type: 'plain_text', text: 'Open dashboard' },
        url: dashboardUrl,
        style: 'primary'
      }]
    }
  ];
}

function buildDashboardLinkModal_(dashboardUrl) {
  return {
    type: 'modal',
    title: { type: 'plain_text', text: 'Hours Tracker' },
    close: { type: 'plain_text', text: 'Close' },
    blocks: buildDashboardLinkBlocks_(dashboardUrl)
  };
}

// Formats one block per project: budget balance at the start of the month
// (if the project has a BudgetHours set), then every roster member's hours
// for that project this month (0 if they didn't log any), then either the
// remaining balance (budgeted projects) or a plain total (unbudgeted ones).
//
// `projects` is [{ name, budget }] (getAllProjects_()); `roster` is every
// known person's display name (getAllKnownUserNames_()); `byProject` is
// { projectName: { personName: hoursThisMonth } } (transposeTally_ of
// computeMonthlyTally_); `usedBeforeMonth` is
// { projectName: hoursLoggedBeforeThisMonth } (getProjectUsedBeforeMonth_).
function formatMonthProjectReport_(monthStr, projects, roster, byProject, usedBeforeMonth) {
  if (projects.length === 0) return 'No projects configured yet.';

  var blocks = projects.map(function (p) {
    var people = byProject[p.name] || {};
    var hasBudget = p.budget != null;
    var monthStart = hasBudget ? p.budget - (usedBeforeMonth[p.name] || 0) : null;

    // Roster plus anyone who logged time on this project but isn't in the
    // roster yet, so the total below is always accurate.
    var names = roster.slice();
    Object.keys(people).forEach(function (name) {
      if (names.indexOf(name) === -1) names.push(name);
    });

    var lines = [p.name + ':'];
    if (hasBudget) {
      lines.push('  ' + padRight_('Month start', 16) + monthStart.toFixed(1) + 'h');
    }

    var monthTotal = 0;
    names.forEach(function (name) {
      var hours = people[name] || 0;
      monthTotal += hours;
      lines.push('  ' + padRight_(name, 16) + hours.toFixed(1) + 'h');
    });

    lines.push('  ' + (hasBudget
      ? padRight_('Remaining', 16) + (monthStart - monthTotal).toFixed(1) + 'h'
      : padRight_('Total', 16) + monthTotal.toFixed(1) + 'h'));

    return lines.join('\n');
  });

  return '*Hours report for ' + monthStr + '*\n```\n' + blocks.join('\n\n') + '\n```';
}

function padRight_(str, len) {
  str = String(str);
  while (str.length < len) str += ' ';
  return str;
}

/**
 * Slack Block Kit view/message builders.
 */

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
  });

  blocks.push({
    type: 'input',
    block_id: 'note',
    optional: true,
    label: { type: 'plain_text', text: 'Note (optional)' },
    element: { type: 'plain_text_input', action_id: 'value', multiline: true }
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

function buildReminderBlocks_() {
  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: ':clock8: Time to log today\'s hours!' }
    },
    {
      type: 'actions',
      elements: [{
        type: 'button',
        text: { type: 'plain_text', text: 'Log hours' },
        action_id: 'open_log_hours_modal',
        style: 'primary'
      }]
    }
  ];
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

/**
 * Slack Block Kit view/message builders.
 */

// One number_input block per active project. Slack modals can't easily grow
// rows dynamically without extra round-trips, so v1 shows every active
// project and the user leaves the ones they didn't touch blank -- fine for
// a team with a handful of concurrent projects. See README for scaling notes.
function buildLogHoursModal_(projects, dateStr) {
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
    blocks.push({
      type: 'input',
      block_id: 'project_' + i,
      optional: true,
      label: { type: 'plain_text', text: project },
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
    private_metadata: JSON.stringify({ date: dateStr, projects: projects }),
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

// Formats { userName: { project: hours } } as a Slack-friendly monospace
// table, plus per-project totals, for /hours-report and the monthly post.
function formatTallyMessage_(monthStr, tally) {
  var userNames = Object.keys(tally).sort();
  if (userNames.length === 0) {
    return 'No hours logged for ' + monthStr + ' yet.';
  }

  var projectTotals = {};
  var lines = [];
  userNames.forEach(function (userName) {
    var projects = tally[userName];
    var userTotal = 0;
    var projectNames = Object.keys(projects).sort();
    lines.push(userName + ':');
    projectNames.forEach(function (project) {
      var hours = projects[project];
      userTotal += hours;
      projectTotals[project] = (projectTotals[project] || 0) + hours;
      lines.push('  ' + padRight_(project, 24) + hours.toFixed(1) + 'h');
    });
    lines.push('  ' + padRight_('Total', 24) + userTotal.toFixed(1) + 'h');
    lines.push('');
  });

  lines.push('Per-project totals:');
  Object.keys(projectTotals).sort().forEach(function (project) {
    lines.push('  ' + padRight_(project, 24) + projectTotals[project].toFixed(1) + 'h');
  });

  return '*Hours tally for ' + monthStr + '*\n```\n' + lines.join('\n') + '\n```';
}

function padRight_(str, len) {
  str = String(str);
  while (str.length < len) str += ' ';
  return str;
}

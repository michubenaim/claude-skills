/**
 * Budget threshold warnings: posts to REPORT_CHANNEL_ID the moment a
 * submission pushes a budgeted project's all-time usage across 90% or
 * 100% of its BudgetHours. Compares before/after this specific submission
 * (rather than just checking the current total) so each threshold only
 * fires once per crossing instead of on every subsequent submission.
 */

function checkAndPostBudgetWarnings_(projectHoursSubmitted, totalsBefore, projectsByName) {
  var reportChannel = getReportChannelId_();
  if (!reportChannel) return;

  Object.keys(projectHoursSubmitted).forEach(function (name) {
    var submitted = projectHoursSubmitted[name];
    if (!submitted) return;

    var project = projectsByName[name];
    if (!project || project.budget == null || project.budget <= 0) return;

    var before = totalsBefore[name] || 0;
    var after = before + submitted;
    var fracBefore = before / project.budget;
    var fracAfter = after / project.budget;
    var remaining = project.budget - after;

    if (fracBefore < 1 && fracAfter >= 1) {
      slackPostMessage_(reportChannel,
        ':rotating_light: *' + name + '* has used up its ' + project.budget.toFixed(1) +
        'h budget (' + Math.abs(remaining).toFixed(1) + 'h over).');
    } else if (fracBefore < 0.9 && fracAfter >= 0.9) {
      slackPostMessage_(reportChannel,
        ':warning: *' + name + '* is at ' + Math.round(fracAfter * 100) + '% of its ' +
        project.budget.toFixed(1) + 'h budget (' + remaining.toFixed(1) + 'h left).');
    }
  });
}

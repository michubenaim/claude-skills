/**
 * Thin wrapper around the Slack Web API, plus inbound request auth.
 *
 * IMPORTANT: Google Apps Script's doPost(e) cannot read HTTP request
 * headers (this is a documented Apps Script limitation, not a bug in
 * this code), so Slack's standard X-Slack-Signature/HMAC verification
 * scheme cannot be implemented here. Instead, this endpoint is secured
 * with a long random shared secret passed as a query string parameter
 * on the Slack Request URL itself, e.g.:
 *   https://script.google.com/macros/s/XXXX/exec?secret=<SHARED_SECRET>
 * Apps Script does reliably parse query string params (unlike headers),
 * and Slack lets you set any URL for slash commands / interactivity, so
 * this is the standard workaround for this stack. See docs/SETUP.md.
 */

function verifySlackRequest_(e) {
  var expected = getSlackSharedSecret_();
  var provided = e.parameter && e.parameter.secret;
  return !!provided && provided === expected;
}

function callSlackApi_(method, payload) {
  var response = UrlFetchApp.fetch('https://slack.com/api/' + method, {
    method: 'post',
    contentType: 'application/json; charset=utf-8',
    headers: { Authorization: 'Bearer ' + getSlackBotToken_() },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var json = JSON.parse(response.getContentText());
  if (!json.ok) {
    Logger.log('Slack API error on ' + method + ': ' + response.getContentText());
  }
  return json;
}

function slackOpenView_(triggerId, view) {
  return callSlackApi_('views.open', { trigger_id: triggerId, view: view });
}

function slackPostMessage_(channel, text, blocks) {
  var payload = { channel: channel, text: text };
  if (blocks) payload.blocks = blocks;
  return callSlackApi_('chat.postMessage', payload);
}

function slackOpenDm_(userId) {
  return callSlackApi_('conversations.open', { users: userId });
}

function slackListUsers_() {
  var users = [];
  var cursor = '';
  do {
    var url = 'https://slack.com/api/users.list?limit=200' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
    var response = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + getSlackBotToken_() },
      muteHttpExceptions: true
    });
    var json = JSON.parse(response.getContentText());
    if (!json.ok) {
      Logger.log('users.list error: ' + response.getContentText());
      break;
    }
    users = users.concat(json.members.filter(function (m) {
      return !m.is_bot && !m.deleted && m.id !== 'USLACKBOT';
    }));
    cursor = json.response_metadata && json.response_metadata.next_cursor;
  } while (cursor);
  return users;
}

/** Run once from the Apps Script editor to print a secret to use in the Request URL. */
function generateSharedSecret() {
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  var secret = '';
  for (var i = 0; i < 32; i++) {
    secret += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  Logger.log('Save this as the SLACK_SHARED_SECRET script property: ' + secret);
  return secret;
}

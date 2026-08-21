'use strict';

/**
 * The ISSUES panel is backed by `gh` OR `glab`, picked in Settings (or detected
 * per repo). The hosts disagree on every JSON field that matters — number/iid,
 * body/description, url/web_url, label + assignee shapes — so one mapper reads
 * both, and the argv builders must not drop a filter flag (a dropped flag
 * silently widens the result set, which looks like working software).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { mapIssues, issueListCommand } = loadTs('src/main/github.ts');

test('flattens GitLab issue objects', () => {
  assert.deepEqual(mapIssues([{
    id: 9001, iid: 42, title: 'Fix the thing', description: 'it is broken',
    web_url: 'https://gitlab.com/acme/app/-/issues/42',
    labels: ['bug', 'p1'], assignees: [{ username: 'ada' }, { username: 'lin' }]
  }]), [{
    number: 42, title: 'Fix the thing', body: 'it is broken',
    url: 'https://gitlab.com/acme/app/-/issues/42',
    labels: ['bug', 'p1'], assignees: ['ada', 'lin']
  }]);
});

test('flattens GitHub issue objects', () => {
  assert.deepEqual(mapIssues([{
    number: 7, title: 'Crash on save', body: 'stack attached',
    url: 'https://github.com/acme/app/issues/7',
    labels: [{ name: 'bug' }, { name: '' }], assignees: [{ login: 'grace' }]
  }]), [{
    number: 7, title: 'Crash on save', body: 'stack attached',
    url: 'https://github.com/acme/app/issues/7',
    labels: ['bug'], assignees: ['grace']
  }]);
});

test('survives the empty and malformed shapes either CLI can emit', () => {
  assert.deepEqual(mapIssues([]), []);
  assert.deepEqual(mapIssues(null), [], 'a null body must not throw');
  assert.deepEqual(mapIssues([{ iid: 7, description: null }]), [{
    number: 7, title: '', body: '', url: '', labels: [], assignees: []
  }], 'unassigned issues carry description: null');
});

test('pushes search and assigned-to-me down to the right CLI', () => {
  const gl = ['issue', 'list', '--output', 'json', '--per-page', '30'];
  const gate = ['issue', 'list', '--json', 'number,title,body,assignees,labels,url,state', '--limit', '30'];
  assert.deepEqual(issueListCommand('gitlab'), { cmd: 'glab', args: gl });
  assert.deepEqual(issueListCommand('github'), { cmd: 'gh', args: gate });
  assert.deepEqual(issueListCommand('gitlab', { search: '  ', mine: false }).args, gl, 'whitespace is not a query');
  assert.deepEqual(
    issueListCommand('gitlab', { search: 'auth', mine: true }),
    { cmd: 'glab', args: [...gl, '--assignee', '@me', '--search', 'auth'] },
    'both filters compose'
  );
  assert.deepEqual(
    issueListCommand('github', { search: 'auth', mine: true }),
    { cmd: 'gh', args: [...gate, '--assignee', '@me', '--search', 'auth'] },
    'both filters compose'
  );
});

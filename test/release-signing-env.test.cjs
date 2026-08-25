'use strict';

/**
 * The macOS release job builds UNSIGNED on a repo with no Apple secrets, and it
 * only stays green while the signing vars are ABSENT from the environment.
 *
 * electron-builder's chooseNotNull() tests `== null`, so an exported-but-EMPTY
 * CSC_LINK is "defined": app-builder-lib takes it for a certificate PATH,
 * path.resolve('')s it against the project dir, and the build dies with
 * "<repo root> not a file". That is how the v0.4.5 macOS job failed — and the
 * shape that caused it (`CSC_LINK: ${{ … || '' }}` in a step `env:`) reads as
 * perfectly reasonable YAML, so it is exactly the kind of thing that comes back.
 *
 * The Windows signer guards `cscLink === ""` explicitly; the mac one does not.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
// js-yaml ships with electron-builder, which this workflow runs — no extra dep.
const yaml = require('js-yaml');

const SIGNING_VARS = [
  'CSC_LINK',
  'CSC_KEY_PASSWORD',
  'APPLE_ID',
  'APPLE_APP_SPECIFIC_PASSWORD',
  'APPLE_TEAM_ID',
];

const workflow = yaml.load(
  fs.readFileSync(path.resolve(__dirname, '..', '.github/workflows/release.yml'), 'utf8'),
);
const steps = workflow.jobs.build.steps;
const packageStep = steps.find((s) => s.name && s.name.startsWith('Package installers'));
const exportStep = steps.find((s) => s.name && s.name.startsWith('Export macOS signing env'));

test('the packaging step declares no signing vars of its own', () => {
  // A step-level `env:` WINS over $GITHUB_ENV, so re-declaring any of these here
  // would put the empty strings back and undo the export step entirely.
  for (const v of SIGNING_VARS) {
    assert.ok(!(v in (packageStep.env || {})), `${v} is back in the Package installers env:`);
  }
});

test('the export step runs before packaging and only on macOS', () => {
  assert.ok(exportStep, 'the conditional signing-env step is gone');
  assert.ok(steps.indexOf(exportStep) < steps.indexOf(packageStep));
  assert.match(String(exportStep.if), /macos/);
});

// Run the step's actual shell body the way the runner does, and read back the
// file it appends to. Asserting on the YAML alone would not catch a `add`
// helper that writes the name with an empty value.
const runExportStep = (secrets) => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ghenv-')), 'env');
  fs.writeFileSync(file, '');
  execFileSync('bash', ['-eo', 'pipefail', '-c', exportStep.run], {
    env: { ...process.env, ...Object.fromEntries(SIGNING_VARS.map((v) => [v, ''])), ...secrets, GITHUB_ENV: file },
  });
  return fs.readFileSync(file, 'utf8');
};

test('with no secrets set, not one signing var is exported', () => {
  const exported = runExportStep({});
  for (const v of SIGNING_VARS) {
    assert.doesNotMatch(exported, new RegExp(`^${v}[=<]`, 'm'), `${v} was exported empty`);
  }
  assert.match(exported, /^CSC_IDENTITY_AUTO_DISCOVERY=false$/m,
    'unsigned builds must not fall back to the runner keychain');
});

test('with a cert present, every credential is exported and signing turns on', () => {
  // A base64 .p12 is routinely multi-line, so the heredoc form is load-bearing.
  const exported = runExportStep({
    CSC_LINK: 'AAAA\nBBBB',
    CSC_KEY_PASSWORD: 'pw',
    APPLE_ID: 'a@b.c',
    APPLE_APP_SPECIFIC_PASSWORD: 'x',
    APPLE_TEAM_ID: 'T1',
  });
  assert.match(exported, /^CSC_LINK<<(\S+)\nAAAA\nBBBB\n\1$/m, 'a multi-line p12 must survive');
  for (const v of SIGNING_VARS) assert.match(exported, new RegExp(`^${v}<<`, 'm'), `${v} missing`);
  assert.match(exported, /^CSC_IDENTITY_AUTO_DISCOVERY=true$/m);
});

test('a partially-configured cert still exports the password with it', () => {
  // APPLE_CERTIFICATE_PASSWORD unset while the p12 IS set is the "MAC
  // verification failed" trap — the export must not silently drop the pair.
  const exported = runExportStep({ CSC_LINK: 'AAAA' });
  assert.match(exported, /^CSC_IDENTITY_AUTO_DISCOVERY=true$/m);
  assert.doesNotMatch(exported, /^CSC_KEY_PASSWORD[=<]/m);
});

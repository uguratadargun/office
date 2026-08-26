'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const cache = new Map();

// The two path aliases tsconfig.web.json declares. Without them a module that
// is otherwise pure and testable — store/taskBulk.ts, say — can only be
// loaded by rewriting its imports to relatives, i.e. by making the source worse
// so the test can read it.
const ALIASES = [
  ['@shared/', 'src/shared'],
  ['@/', 'src/renderer/src']
];

function resolveTs(fromDir, request) {
  const alias = ALIASES.find(([prefix]) => request.startsWith(prefix));
  const base = alias
    ? path.resolve(__dirname, '..', alias[1], request.slice(alias[0].length))
    : path.resolve(fromDir, request);
  for (const candidate of [base, `${base}.ts`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function loadFile(filename) {
  const cached = cache.get(filename);
  if (cached) return cached.exports;
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      strict: true,
      // Match tsconfig.node/tsconfig.web. Without it a default import of a CJS
      // builtin (`import path from 'node:path'`) compiles to `path_1.default`,
      // which is undefined at run time — the module loads fine and then explodes
      // on first use. Test harness only; no shipped code compiles through here.
      esModuleInterop: true
    },
    fileName: filename,
    reportDiagnostics: true
  });
  if (output.diagnostics?.length) {
    throw new Error(ts.formatDiagnosticsWithColorAndContext(output.diagnostics, {
      getCurrentDirectory: () => process.cwd(),
      getCanonicalFileName: (name) => name,
      getNewLine: () => '\n'
    }));
  }
  const mod = { exports: {} };
  cache.set(filename, mod);
  const localRequire = (request) => {
    if (request.startsWith('.') || ALIASES.some(([prefix]) => request.startsWith(prefix))) {
      // ponytail: a .ts module that imports a .tsx (nav.ts -> navBadge.tsx) gets an
      // inert stub for the component module — node tests never render; drop this if
      // a test ever needs the real component (then teach the compiler JSX).
      const tsx = path.resolve(path.dirname(filename), request) + '.tsx';
      if (request.startsWith('.') && fs.existsSync(tsx)) return new Proxy({}, { get: () => () => null });
      const resolved = resolveTs(path.dirname(filename), request);
      if (resolved) return loadFile(resolved);
    }
    return require(request);
  };
  const run = new Function('module', 'exports', 'require', '__filename', '__dirname', output.outputText);
  run(mod, mod.exports, localRequire, filename, path.dirname(filename));
  return mod.exports;
}

/** Load a TypeScript module and its local TypeScript imports for node:test. */
module.exports = function loadTs(relativePath) {
  return loadFile(path.resolve(__dirname, '..', relativePath));
};

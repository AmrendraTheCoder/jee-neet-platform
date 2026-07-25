// Metro configuration for a pnpm workspace.
//
// pnpm's strict node_modules layout means Metro cannot find hoisted packages by
// walking up from the app directory alone; it has to be told about the workspace
// root explicitly. `@platform/domain` is consumed as raw TypeScript source
// (its package main points at src/index.ts), which Metro transpiles like any
// other module — that keeps the scoring engine a single source of truth rather
// than a stale build artefact.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
  // pnpm virtual store — needed so Metro can resolve packages (e.g.
  // @expo/metro-runtime) that are imported by packages living inside the
  // .pnpm directory but are not direct dependencies of those packages.
  path.resolve(workspaceRoot, 'node_modules/.pnpm/node_modules'),
];
config.resolver.disableHierarchicalLookup = true;

// The KaTeX renderer is inlined into a generated TypeScript module rather than
// shipped as sibling assets (see scripts/vendor-katex.mjs), so no extra asset
// extension is registered here. That is what lets the math WebView load from a
// generated HTML string with no base URL and behave identically on both
// platforms and in a development client.

module.exports = config;

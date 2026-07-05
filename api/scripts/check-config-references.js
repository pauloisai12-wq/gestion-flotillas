const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');

const filesToScan = [
  'AGENTS.md',
  '.codex/agents/backend.toml',
  '.codex/agents/frontend-perf.toml',
  '.codex/agents/linux-readiness.toml',
  '.codex/agents/sql-auditor.toml',
];

const pathPattern = /(?:`|^-\s+[^:]+:\s*)([A-Za-z0-9_.\/-]+\.(?:md|toml|yml|yaml|sh|ts|tsx|js|json))/gm;
const missing = [];

for (const relativeFile of filesToScan) {
  const filePath = path.join(repoRoot, relativeFile);
  if (!fs.existsSync(filePath)) {
    missing.push(`${relativeFile} (referenced scan target is missing)`);
    continue;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  for (const match of content.matchAll(pathPattern)) {
    const referencedPath = match[1];
    if (
      referencedPath.startsWith('api/') ||
      referencedPath.startsWith('web/') ||
      referencedPath.startsWith('worker/') ||
      referencedPath.startsWith('docs/') ||
      referencedPath.startsWith('.codex/')
    ) {
      const absolute = path.join(repoRoot, referencedPath);
      if (!fs.existsSync(absolute)) {
        missing.push(`${relativeFile} -> ${referencedPath}`);
      }
    }
  }
}

if (missing.length > 0) {
  console.error('Missing referenced config/docs files:');
  for (const item of missing) console.error(`- ${item}`);
  process.exit(1);
}

console.log('config reference check passed');

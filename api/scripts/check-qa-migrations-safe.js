const fs = require('node:fs');
const path = require('node:path');

const migrationsDir = path.resolve(__dirname, '..', 'prisma', 'migrations');

const forbidden = [
  {
    label: 'DELETE FROM qa_externa_*',
    pattern: /\bDELETE\s+FROM\s+"?qa_externa_[a-z0-9_]+"?/i,
  },
  {
    label: 'TRUNCATE qa_externa_*',
    pattern: /\bTRUNCATE(?:\s+TABLE)?\s+"?qa_externa_[a-z0-9_]+"?/i,
  },
  {
    label: 'DROP TABLE qa_externa_*',
    pattern: /\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?qa_externa_[a-z0-9_]+"?/i,
  },
];

function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '');
}

function lineForIndex(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

const findings = [];

for (const dirent of fs.readdirSync(migrationsDir, { withFileTypes: true })) {
  if (!dirent.isDirectory()) continue;

  const migrationPath = path.join(migrationsDir, dirent.name, 'migration.sql');
  if (!fs.existsSync(migrationPath)) continue;

  const sql = fs.readFileSync(migrationPath, 'utf8');
  const stripped = stripSqlComments(sql);

  for (const rule of forbidden) {
    const match = rule.pattern.exec(stripped);
    if (match) {
      findings.push({
        file: path.relative(path.resolve(__dirname, '..'), migrationPath),
        line: lineForIndex(stripped, match.index),
        rule: rule.label,
      });
    }
  }
}

if (findings.length > 0) {
  console.error('Unsafe qa_externa migration statements found:');
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} (${finding.rule})`);
  }
  process.exit(1);
}

console.log('qa_externa migration safety check passed');

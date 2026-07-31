// Guard de migraciones: ninguna migración puede borrar datos de ingesta móvil
// (qa_externa de GeoCampo y encuestas de Okrean). Son capturas de campo que no
// se pueden reconstruir: si una migración necesita reestructurarlas, debe
// hacerlo con ALTER/UPDATE, nunca vaciando ni tirando la tabla.
const fs = require('node:fs');
const path = require('node:path');

const migrationsDir = path.resolve(__dirname, '..', 'prisma', 'migrations');

// La tabla principal de encuestas se llama `encuestas` a secas; el sufijo
// (`encuestas_dispositivos`, ...) es opcional en el patrón.
const PROTECTED_TABLE = '(?:qa_externa_[a-z0-9_]+|encuestas(?:_[a-z0-9_]+)?)';

const forbidden = [
  {
    label: 'DELETE FROM tabla protegida',
    pattern: new RegExp(`\\bDELETE\\s+FROM\\s+"?${PROTECTED_TABLE}"?`, 'i'),
  },
  {
    label: 'TRUNCATE tabla protegida',
    pattern: new RegExp(`\\bTRUNCATE(?:\\s+TABLE)?\\s+"?${PROTECTED_TABLE}"?`, 'i'),
  },
  {
    label: 'DROP TABLE tabla protegida',
    pattern: new RegExp(
      `\\bDROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?"?${PROTECTED_TABLE}"?`,
      'i',
    ),
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
  console.error('Unsafe qa_externa/encuestas migration statements found:');
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} (${finding.rule})`);
  }
  process.exit(1);
}

console.log('qa_externa/encuestas migration safety check passed');

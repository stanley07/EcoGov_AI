const fs = require('fs');
const cp = require('child_process');
const path = require('path');

const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
const env = { ...process.env };

envFile.split('\n').forEach(line => {
  line = line.trim();
  if (!line || line.startsWith('#')) return;
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) {
    const key = match[1].trim();
    let val = match[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
});

env.DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:5433/govos_db";

const cmd = process.argv.slice(2).join(' ');
if (!cmd) {
  console.error("No command specified");
  process.exit(1);
}

console.log(`Running: ${cmd}`);
try {
  cp.execSync(cmd, { stdio: 'inherit', env });
  process.exit(0);
} catch (err) {
  process.exit(1);
}

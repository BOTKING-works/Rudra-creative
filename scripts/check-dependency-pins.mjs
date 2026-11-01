import { readFileSync } from 'node:fs';

const manifests = [
  'package.json',
  'backend/package.json',
  'frontend/package.json',
  'admin/package.json',
];
const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const problems = [];

for (const path of manifests) {
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  for (const group of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [name, version] of Object.entries(manifest[group] ?? {})) {
      if (!exactVersion.test(version)) {
        problems.push(`${path}: ${group}.${name} must be an exact version; got ${version}`);
      }
    }
  }
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`Dependency pin policy passed for ${manifests.length} package manifests.`);

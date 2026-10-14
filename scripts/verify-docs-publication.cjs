#!/usr/bin/env node
// Prepared artifacts become public only after the canonical npm release matches their exact bytes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const NAME = '@enterpriseai/cli';
const PRIMARY = 'https://registry.npmjs.org/@enterpriseai%2fcli';
const RELEASE_VISIBILITY_MS = 180000;
const RETRY_GAP_MS = 5000;
const REQUEST_TIMEOUT_MS = 15000;

function preparedRelease(root = ROOT) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (pkg.name !== NAME || !/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error('Invalid canonical release package.');
  const registry = path.join(root, 'docs-site/static/registry');
  const bytes = fs.readFileSync(path.join(registry, '@enterpriseai/cli'));
  for (const alias of ['@enterpriseai%2fcli', '@enterpriseai%2Fcli', '%40enterpriseai%2Fcli']) {
    if (!fs.readFileSync(path.join(registry, alias)).equals(bytes)) throw new Error('Prepared registry alias mismatch.');
  }
  const packument = JSON.parse(bytes);
  const entry = packument.versions?.[pkg.version];
  if (packument.name !== NAME || packument['dist-tags']?.latest !== pkg.version || entry?.name !== NAME || entry.version !== pkg.version) {
    throw new Error('Prepared registry version mismatch.');
  }
  const archive = path.join(registry, '-/@enterpriseai', 'cli-' + pkg.version + '.tgz');
  const data = fs.readFileSync(archive);
  const shasum = crypto.createHash('sha1').update(data).digest('hex');
  const integrity = 'sha512-' + crypto.createHash('sha512').update(data).digest('base64');
  if (entry.dist?.tarball !== `https://eai-support.github.io/eai/registry/-/@enterpriseai/cli-${pkg.version}.tgz`
    || entry.dist?.shasum !== shasum || entry.dist?.integrity !== integrity
    || !fs.readFileSync(path.join(registry, '-/@enterpriseai/cli-latest.tgz')).equals(data)) {
    throw new Error('Prepared archive checksum mismatch.');
  }
  return { version: pkg.version, archive, shasum, integrity };
}

async function readPublishedPackage(timeoutMs = REQUEST_TIMEOUT_MS) {
  const response = await fetch(PRIMARY, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs), headers: { 'cache-control': 'no-cache' } });
  if (!response.ok) throw new Error('Canonical publication unavailable.');
  return response.json();
}

async function verifyDocsPublication({ root = ROOT, readPublished = readPublishedPackage, requestTimeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  let prepared;
  try { prepared = preparedRelease(root); } catch { return { allowed: false, reason: 'prepared-artifacts-invalid' }; }
  try {
    const published = await readPublished(requestTimeoutMs);
    const entry = published?.versions?.[prepared.version];
    if (published?.name !== NAME || published?.['dist-tags']?.latest !== prepared.version
      || entry?.name !== NAME || entry?.version !== prepared.version
      || entry?.dist?.shasum !== prepared.shasum || entry?.dist?.integrity !== prepared.integrity) {
      return { allowed: false, reason: 'canonical-publication-does-not-match', version: prepared.version };
    }
    return { allowed: true, reason: 'canonical-publication-matches', version: prepared.version };
  } catch { return { allowed: false, reason: 'canonical-publication-unavailable', version: prepared.version }; }
}

async function waitForDocsPublication({ release = false, now = () => performance.now(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), verify = verifyDocsPublication } = {}) {
  const deadline = now() + (release ? RELEASE_VISIBILITY_MS : 0);
  let result = { allowed: false, reason: 'canonical-publication-unavailable' };
  do {
    const remaining = deadline - now();
    if (release && remaining <= 0) return result;
    const requestTimeoutMs = release ? Math.max(1, Math.floor(Math.min(REQUEST_TIMEOUT_MS, remaining))) : REQUEST_TIMEOUT_MS;
    result = await verify({ requestTimeoutMs });
    if (result.allowed || result.reason === 'prepared-artifacts-invalid' || !release) return result;
    const timeLeft = deadline - now();
    if (timeLeft <= 0) return result;
    await sleep(Math.min(RETRY_GAP_MS, timeLeft));
  } while (now() < deadline);
  return result;
}

function verifyPreparedSource(root = ROOT) {
  const prepared = preparedRelease(root);
  // The trusted Ubuntu release runner supplies Python's standard archive reader.
  // Compare without extracting or executing archive contents; reject links and unsafe paths.
  const source = `import sys,tarfile,pathlib
root=pathlib.Path(sys.argv[2]).resolve()
expected={"package.json"}
for directory in ["dist","resources"]:
 for p in (root/directory).rglob("*"):
  if p.is_symlink(): raise ValueError("Linked runtime source")
  if p.is_file(): expected.add(p.relative_to(root).as_posix())
seen=set();total=0
with tarfile.open(sys.argv[1],"r:gz") as archive:
 for member in archive:
  name=pathlib.PurePosixPath(member.name)
  if not member.isfile() or not member.name.startswith("package/") or ".." in name.parts: raise ValueError("Unsafe prepared archive")
  relative=member.name[len("package/"):]
  if relative in ["README.md","LICENSE","NOTICE"]: continue
  if relative not in expected or relative in seen: raise ValueError("Unexpected prepared runtime")
  total+=member.size
  if len(seen)>=5000 or total>64*1024*1024: raise ValueError("Prepared runtime is too large")
  if archive.extractfile(member).read()!=(root/relative).read_bytes(): raise ValueError("Prepared runtime differs from current source")
  seen.add(relative)
if seen!=expected: raise ValueError("Prepared runtime inventory mismatch")
print(len(seen))
`;
  const count = Number(execFileSync('python3', ['-c', source, prepared.archive, root], { encoding: 'utf8', timeout: 30000 }));
  if (!Number.isSafeInteger(count) || count <= 0) throw new Error('Prepared runtime could not be verified.');
  return { ...prepared, runtimeFilesVerified: count };
}

async function main() {
  if (process.argv.slice(2).join(' ') === '--prepared-source') {
    console.log(JSON.stringify(verifyPreparedSource())); return;
  }
  if (process.argv.length !== 2) throw new Error('Unsupported publication verifier option.');
  const result = await waitForDocsPublication({ release: process.env.REQUIRE_PUBLISHED_RELEASE === 'true' });
  console.log(JSON.stringify(result));
  if (!result.allowed) process.exitCode = 1;
}
if (require.main === module) main().catch(() => { console.error('Publication verification failed.'); process.exitCode = 1; });
module.exports = { preparedRelease, verifyDocsPublication, verifyPreparedSource, waitForDocsPublication };

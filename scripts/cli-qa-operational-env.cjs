// Shared environment for qualification subprocesses, including candidate Git reads.
function operationalEnvironment(environment) {
  const allowed = new Set(['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'PATH', 'Path', 'PATHEXT',
    'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'windir', 'COMSPEC', 'ComSpec', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL',
    'TERM', 'CI', 'NO_COLOR', 'FORCE_COLOR', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
    'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR']);
  return Object.fromEntries(Object.entries(environment).filter(([key, value]) => allowed.has(key) && typeof value === 'string'));
}
/** Conventional system Git selection is independent of PATH; operator installation/config remain trusted. */
let installedGitCache;
function installedGitExecution() {
  const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
  const candidates = process.platform === 'win32'
    ? [...new Set([process.env.ProgramW6432, process.env.ProgramFiles, process.env['ProgramFiles(x86)'], 'C:\\Program Files'].filter(Boolean))]
      .flatMap(root => [path.join(root, 'Git', 'cmd', 'git.exe'), path.join(root, 'Git', 'bin', 'git.exe')])
    : ['/usr/bin/git', ...(process.platform === 'darwin' ? ['/opt/homebrew/bin/git'] : []), '/usr/local/bin/git', '/bin/git'];
  if (process.platform === 'win32' && process.env.LOCALAPPDATA)
    candidates.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'cmd', 'git.exe'));
  for (const selected of candidates) {
    if (!fs.existsSync(selected)) continue;
    const gitPath = fs.realpathSync(selected);
    const stat = fs.statSync(gitPath, { bigint: true });
    if (!stat.isFile()) continue;
    const stamp = [gitPath, stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
    if (installedGitCache?.stamp === stamp) return structuredClone(installedGitCache.value);
    const version = require('node:child_process').spawnSync(gitPath, ['--version'], {
      encoding: 'utf8', env: operationalEnvironment(process.env), timeout: 10000, shell: false,
    });
    if (version.status !== 0 || version.error || version.signal || !/^git version [^\r\n]{1,100}$/.test(version.stdout.trim())) continue;
    const value = { schemaVersion: 'eai.cli-installed-git-execution.v1', selection: 'conventional-installation', gitPath,
      gitSha256: crypto.createHash('sha256').update(fs.readFileSync(gitPath)).digest('hex'), gitVersion: version.stdout.trim() };
    const after = fs.statSync(gitPath, { bigint: true });
    if ([gitPath, after.dev, after.ino, after.size, after.mtimeNs, after.ctimeNs].join(':') !== stamp) continue;
    installedGitCache = { stamp, value }; return structuredClone(value);
  }
  throw new Error('A conventional installed Git executable is required for source qualification.');
}
module.exports = { operationalEnvironment, installedGitExecution };

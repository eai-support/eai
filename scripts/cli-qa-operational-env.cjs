// Shared environment for qualification subprocesses, including candidate Git reads.
function operationalEnvironment(environment) {
  const allowed = new Set(['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'PATH', 'Path', 'PATHEXT',
    'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'windir', 'COMSPEC', 'ComSpec', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL',
    'TERM', 'CI', 'NO_COLOR', 'FORCE_COLOR', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
    'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR']);
  return Object.fromEntries(Object.entries(environment).filter(([key, value]) => allowed.has(key) && typeof value === 'string'));
}
module.exports = { operationalEnvironment };

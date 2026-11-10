const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// The metadata is outside the tree digest so timestamps cannot alter identity.
function goferResourceTreeSha256(root) {
  const rows = [];
  function visit(directory, prefix = '') {
    for (const name of fs.readdirSync(directory).sort()) {
      const relative = prefix ? `${prefix}/${name}` : name;
      if (relative === '.gofer-version') continue;
      const file = path.join(directory, name);
      const stat = fs.lstatSync(file);
      if (stat.isDirectory()) visit(file, relative);
      else if (stat.isFile()) rows.push([relative, createHash('sha256').update(fs.readFileSync(file)).digest('hex')]);
      else throw new Error(`Unsupported bundled Gofer entry: ${relative}`);
    }
  }
  visit(root);
  return `sha256:${createHash('sha256').update(JSON.stringify(rows)).digest('hex')}`;
}

module.exports = { goferResourceTreeSha256 };

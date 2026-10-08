/** Read a secret from a real terminal only. Never from a pipe, an argument,
 * the environment, or a file: a person must be present to type it. */
import process from 'node:process';

const denied = () => new Error('INTERACTIVE_TERMINAL_REQUIRED');
const CANCEL = new Set([String.fromCharCode(3), String.fromCharCode(4)]);
const BACKSPACE = new Set([String.fromCharCode(127), String.fromCharCode(8)]);

export function promptHidden(label, { stdin = process.stdin, stdout = process.stdout } = {}) {
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== 'function') throw denied();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error, result) => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
      if (error) reject(error);
      else resolve(result);
    };
    const onData = chunk => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\r' || character === '\n') return finish(null, value);
        if (CANCEL.has(character)) return finish(new Error('PASSPHRASE_ENTRY_CANCELLED'));
        if (BACKSPACE.has(character)) value = value.slice(0, -1);
        else if (character >= ' ') value += character;
      }
    };
    stdout.write(label);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

import { Command } from 'commander';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import inquirer from 'inquirer';
import { getBrowserOpenCommand, loadTokens } from '../lib/auth.js';
import { collectSupportBundle, createSupportDraft, resolveSupportWebsite, SupportRequestError, type SupportOptions } from '../lib/support-report.js';

const execFileAsync = promisify(execFile);

export interface SupportDependencies {
  readonly confirm?: () => Promise<boolean>;
  readonly isInteractive?: boolean;
  readonly openBrowser?: (url: string) => Promise<void>;
}

async function openSupportBrowser(url: string): Promise<void> {
  const { command, args } = getBrowserOpenCommand(url);
  await execFileAsync(command, args, { timeout: 5000 });
}

async function confirmSupport(): Promise<boolean> {
  const answers = await inquirer.prompt<{ consent: boolean }>([{
    type: 'confirm', name: 'consent', default: false,
    message: 'Send this redacted report to EAI Support for a temporary draft?',
  }]);
  return answers.consent;
}

export async function runSupport(options: SupportOptions, dependencies: SupportDependencies = {}): Promise<void> {
  const json = options.format === 'json';
  let plainUrl: string | undefined;
  const emit = (result: Record<string, unknown>): void => {
    // The validated capability link is the only token-bearing output; do not serialize the server response.
    if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else {
      if (typeof result.message === 'string') console.log(result.message);
      if (typeof result.url === 'string') console.log(result.url);
    }
  };
  try {
    const website = await resolveSupportWebsite();
    plainUrl = `${website}/support`;
    const session = await loadTokens();
    const bundle = await collectSupportBundle(options, session);
    if (!json) {
      console.log('Redacted support report (review before sending):');
      console.log(JSON.stringify(bundle, null, 2));
    }
    if (!session?.accessToken || !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()) {
      emit({ ok: true, status: 'signed_out', bundle, url: plainUrl,
        message: 'No valid eai login session. Open the Support page to report this manually; no draft was created.' });
      return;
    }
    // JSON mode is a preview until the human has approved the report in the harness chat.
    const interactive = dependencies.isInteractive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
    if (!options.yes && (json || !interactive)) {
      emit({ ok: true, status: 'consent_required', bundle,
        message: 'Show this bundle to the person and ask for consent. Only after explicit approval, rerun with --yes.' });
      return;
    }
    if (!options.yes && !await (dependencies.confirm ?? confirmSupport)()) {
      emit({ ok: true, status: 'declined', bundle, message: 'No report was sent and no draft was created.' });
      return;
    }
    const draft = await createSupportDraft(website, bundle, session.accessToken);
    if (!draft) {
      emit({ ok: true, status: 'signed_out', bundle, url: plainUrl,
        message: 'The website rejected the login session. Open the Support page to report this manually; no draft was created.' });
      return;
    }
    emit({ ok: true, status: 'created', bundle, url: draft.url, expiresAt: draft.expiresAt,
      message: 'Support draft created. Open the link to review and submit it before it expires.' });
    if (!json && options.open !== false) {
      try { await (dependencies.openBrowser ?? openSupportBrowser)(draft.url); }
      catch { console.error('The browser could not open. Use the Support link printed above.'); }
    }
  } catch (error) {
    const message = error instanceof SupportRequestError ? error.message
      : 'The support report could not be prepared. Check the support options and website configuration.';
    const code = error instanceof SupportRequestError ? error.code : 'invalid_report';
    if (json) emit({ ok: false, status: 'failed', error: { code, message }, url: plainUrl });
    else {
      console.error(message);
      if (plainUrl) console.log(plainUrl);
    }
    process.exitCode = 1;
  }
}

export const supportCommand = new Command('support')
  .description('Review a redacted error report and hand it to the Support page with consent')
  .option('--format <format>', 'Output format (text|json); JSON previews until consent is given', 'text')
  .option('--source <source>', 'Report source (eai-cli|harness)')
  .option('--tool <name>', 'AI harness name; selects harness source unless --source is set')
  .option('--tool-version <version>', 'AI harness version, when known')
  .option('--command <command>', 'Failing command, with credentials omitted')
  .option('--exit-code <code>', 'Failing command exit code')
  .option('--error-code <code-or-reason>', 'Error code or reason from eai errors list')
  .option('--description <text>', 'Optional report description, redacted locally')
  .option('--yes', 'Send only when the person has already explicitly consented to this report', false)
  .option('--no-open', 'Print the Support link without opening the browser')
  .addHelpText('after', '\nWithout --yes, JSON and noninteractive runs only preview the report.\nAfter the person approves the preview, rerun the same command with --yes.\nOnly the draft id and one-time token appear in the link fragment.\n')
  .action(async (options: SupportOptions) => { await runSupport(options); });

import { Command } from 'commander';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import inquirer from 'inquirer';
import { getBrowserOpenCommand, loadTokens } from '../lib/auth.js';
import {
  bundleDigest,
  createHarnessContextFile,
  discardOwnedHarnessContext,
  purgeStaleHarnessContexts,
  isOrganisationLocation,
  renderSupportPreview,
  SupportContextError,
  type OrganisationLocation,
} from '../lib/support-harness.js';
import {
  createSupportDraft,
  prepareSupportReport,
  resolveSupportWebsite,
  supportChatUrl,
  SupportRequestError,
  type SupportBundle,
  type SupportOptions,
} from '../lib/support-report.js';

const execFileAsync = promisify(execFile);

/** Prompt/browser hooks for controlled callers; overriding interactivity never grants consent. */
export interface SupportDependencies {
  readonly confirm?: () => Promise<boolean>;
  readonly chooseOrganisationLocation?: () => Promise<OrganisationLocation>;
  readonly isInteractive?: boolean;
  readonly openBrowser?: (url: string) => Promise<void>;
  readonly stdin?: NodeJS.ReadableStream;
}

const ORGANISATION_LOCATION_CHOICES: ReadonlyArray<{ readonly name: string; readonly value: OrganisationLocation }> = [
  { name: 'Australia and Asia Pacific', value: 'apac' },
  { name: 'Europe, the Middle East and Africa', value: 'emea' },
  { name: 'The Americas', value: 'americas' },
];
const ORGANISATION_LOCATION_QUESTION = 'Where is your organisation based?';
const PREVIEW_MESSAGE = 'Show previewText to the person unchanged and ask whether to send it. Only after explicit approval, rerun the same command with --yes --approved-digest <bundleDigest>.';
const LOCATION_MESSAGE = `Ask the person: ${ORGANISATION_LOCATION_QUESTION} Rerun with --organisation-location apac|emea|americas before asking for approval. Nothing was sent.`;

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

async function askOrganisationLocation(): Promise<OrganisationLocation> {
  const answers = await inquirer.prompt<{ location: OrganisationLocation }>([{
    type: 'select', name: 'location', message: ORGANISATION_LOCATION_QUESTION,
    choices: ORGANISATION_LOCATION_CHOICES.map(choice => ({ ...choice })),
  }]);
  return answers.location;
}

function withLocation(bundle: SupportBundle, organisationLocation: OrganisationLocation): SupportBundle {
  const { harness, ...rest } = bundle;
  return { ...rest, organisationLocation, ...(harness ? { harness } : {}) };
}

/**
 * Previews a locally redacted report; options.yes plus a matching --approved-digest asserts the person approved that exact report.
 * JSON/noninteractive callers otherwise preview only; interactive text asks before sending.
 * JSON emits context_created, declined, consent_required, consent_stale, signed_out, region_required, created or failed and never opens a browser.
 * Preparation/request failures set process.exitCode to 1; every no-draft outcome returns the chat link without prefill.
 */
export async function runSupport(options: SupportOptions, dependencies: SupportDependencies = {}): Promise<void> {
  const json = options.format === 'json';
  let chatUrl = supportChatUrl('https://www.enterpriseaigroup.com');
  const emit = (result: Record<string, unknown>): void => {
    // The validated capability link is the only token-bearing output; do not serialize the server response.
    if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else {
      if (typeof result.message === 'string') console.log(result.message);
      if (typeof result.url === 'string') console.log(result.url);
    }
  };
  try {
    if (options.decline && (options.yes || options.createContextFile)) {
      const message = '--decline cannot be combined with --yes or --create-context-file.';
      emit({ ok: false, status: 'failed', error: { code: 'invalid_report', message }, url: chatUrl, message });
      process.exitCode = 1;
      return;
    }
    if (options.decline) {
      discardOwnedHarnessContext(options.contextFile);
      emit({ ok: true, status: 'declined', url: chatUrl, message: 'No report was sent and no draft was created.' });
      return;
    }
    if (options.createContextFile) {
      const contextFile = createHarnessContextFile();
      emit({ ok: true, status: 'context_created', contextFile, url: chatUrl,
        message: 'Write the JSON session summary into contextFile, then preview it with --context-file. Nothing was sent.' });
      return;
    }
    const website = await resolveSupportWebsite();
    purgeStaleHarnessContexts();
    chatUrl = supportChatUrl(website);
    const session = await loadTokens();
    const report = await prepareSupportReport(options, session, dependencies.stdin);
    let bundle = report.bundle;
    const signedIn = Boolean(session?.accessToken) && Number.isFinite(session?.expiresAt) && (session?.expiresAt ?? 0) > Date.now();
    const interactive = dependencies.isInteractive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
    // The website stores a report in the organisation's home region; without an active workspace the person names it.
    const needsLocation = signedIn && !session?.activeTenantId && !isOrganisationLocation(options.organisationLocation);
    if (needsLocation && !json && interactive) {
      bundle = withLocation(bundle, await (dependencies.chooseOrganisationLocation ?? askOrganisationLocation)());
    }
    const questions = needsLocation && !bundle.organisationLocation ? ['organisationLocation'] : [];
    const digest = bundleDigest(bundle);
    const previewText = renderSupportPreview({ ...bundle }, digest);
    const ignored = report.ignoredLastError ? { ignoredLastError: report.ignoredLastError } : {};
    if (!json) {
      if (report.ignoredLastError) {
        console.log(`The error saved on ${report.ignoredLastError.recordedAt} is older than 24 hours and was left out. Pass --command and --error-code to describe it, or rerun the failing command first.`);
      }
      console.log('Redacted support report (review before sending):');
      console.log(JSON.stringify(bundle, null, 2));
      console.log(`Report digest: ${digest}`);
    }
    if (!signedIn) {
      emit({ ok: true, status: 'signed_out', bundle, previewText, bundleDigest: digest, url: chatUrl, ...ignored,
        message: 'No valid eai login session. Open the Support chat to report this manually; no draft was created. The redacted report above can be pasted into the chat.' });
      return;
    }
    if (questions.length > 0) {
      emit({ ok: true, status: 'consent_required', bundle, previewText, bundleDigest: digest, questions, url: chatUrl, ...ignored, message: LOCATION_MESSAGE });
      return;
    }
    // JSON mode is a preview until the human has approved the report in the harness chat.
    if (!options.yes && (json || !interactive)) {
      emit({ ok: true, status: 'consent_required', bundle, previewText, bundleDigest: digest, url: chatUrl, ...ignored, message: PREVIEW_MESSAGE });
      return;
    }
    if (options.yes) {
      // Relayed consent must name the exact report the person saw; any change invalidates it.
      const approved = options.approvedDigest?.trim().toLowerCase();
      if ((json || !interactive || approved !== undefined) && approved !== digest) {
        emit({ ok: false, status: 'consent_stale', bundle, previewText, bundleDigest: digest, url: chatUrl, ...ignored,
          message: approved === undefined
            ? 'Approval must name the previewed report: rerun with --yes --approved-digest <bundleDigest> after the person approves previewText. Nothing was sent.'
            : 'The report changed since it was approved. Show previewText again and, after approval, rerun with the new --approved-digest. Nothing was sent.' });
        process.exitCode = 1;
        return;
      }
    } else if (!await (dependencies.confirm ?? confirmSupport)()) {
      discardOwnedHarnessContext(options.contextFile);
      emit({ ok: true, status: 'declined', bundle, url: chatUrl, ...ignored, message: 'No report was sent and no draft was created.' });
      return;
    }
    let draft;
    try {
      draft = await createSupportDraft(website, bundle, session?.accessToken ?? '');
    } catch (error) {
      if (error instanceof SupportRequestError && error.code === 'region_required') {
        const unanswered = !bundle.organisationLocation;
        emit({ ok: true, status: 'region_required', bundle, url: chatUrl, ...(unanswered ? { questions: ['organisationLocation'] } : {}), ...ignored,
          message: `${error.message} ${unanswered ? LOCATION_MESSAGE : ''} Open the Support chat to report this manually.`.replace(/\s+/g, ' ') });
        return;
      }
      throw error;
    }
    if (!draft) {
      emit({ ok: true, status: 'signed_out', bundle, previewText, bundleDigest: digest, url: chatUrl, ...ignored,
        message: 'The website rejected the login session. Open the Support chat to report this manually; no draft was created.' });
      return;
    }
    discardOwnedHarnessContext(options.contextFile);
    emit({ ok: true, status: 'created', bundle, url: draft.url, expiresAt: draft.expiresAt, ...ignored,
      message: 'Support draft created. Open the link to review and submit it before it expires.' });
    if (!json && options.open !== false) {
      try { await (dependencies.openBrowser ?? openSupportBrowser)(draft.url); }
      catch { console.error('The browser could not open. Use the Support link printed above.'); }
    }
  } catch (error) {
    if (error instanceof SupportContextError) discardOwnedHarnessContext(options.contextFile);
    const safe = error instanceof SupportRequestError || error instanceof SupportContextError;
    const message = safe ? error.message
      : 'The support report could not be prepared. Check the support options and website configuration.';
    const code = safe ? error.code : 'invalid_report';
    if (json) emit({ ok: false, status: 'failed', error: { code, message }, url: chatUrl });
    else {
      console.error(message);
      if (chatUrl) console.log(chatUrl);
    }
    process.exitCode = 1;
  }
}

/** CLI support entry point; --yes is reserved for the person's explicit approval of the previewed report. */
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
  .option('--decline', 'Decline a preview and remove only its CLI-owned context file; no report is sent')
  .option('--create-context-file', 'Allocate a private CLI-owned file for a harness summary; no report is sent')
  .option('--context-file <path>', 'JSON session summary from the AI harness (- reads stdin); redacted and capped locally')
  .option('--approved-digest <sha256>', 'bundleDigest of the previewed report the person approved; required with --yes in JSON or noninteractive runs')
  .option('--organisation-location <location>', 'Where the organisation is based (apac|emea|americas) when the session has no active workspace')
  .option('--no-last-error', 'Leave the saved context of the last failing command out of the report')
  .option('--yes', 'Send only when the person has already explicitly consented to this report', false)
  .option('--no-open', 'Print the Support link without opening the browser')
  .addHelpText('after', '\n--create-context-file and --decline operate locally without sending a report.\nWithout --yes, other JSON and noninteractive runs only preview the report and return previewText and bundleDigest.\nAfter the person approves that preview, rerun the same command with --yes --approved-digest <bundleDigest>.\nA changed report answers consent_stale and sends nothing. Only the draft id and one-time token appear in the link fragment.\nWithout a draft (signed out, declined, region_required), the printed link opens the Support chat without prefill.\n')
  .action(async (options: SupportOptions) => { await runSupport(options); });

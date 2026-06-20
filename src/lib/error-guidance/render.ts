import type { ErrorGuidance, ErrorGuidanceJson, GuidanceCommand } from './types.js';

function interpolate(template: string, context?: Record<string, string>): string {
  if (!context) return template;
  return Object.entries(context).reduce((result, [key, value]) => (
    result.replace(new RegExp(`\\{${key}\\}`, 'g'), value)
  ), template);
}

function interpolateList(values: string[], context?: Record<string, string>): string[] {
  return values.map((value) => interpolate(value, context));
}

function interpolateCommand(command: GuidanceCommand, context?: Record<string, string>): GuidanceCommand {
  return {
    ...command,
    command: interpolate(command.command, context),
    purpose: interpolate(command.purpose, context),
    when: command.when ? interpolate(command.when, context) : undefined,
    requires: command.requires?.map((value) => interpolate(value, context)),
  };
}

export function guidanceToJSON(
  guidance: ErrorGuidance,
  context?: Record<string, string>,
): ErrorGuidanceJson {
  return {
    code: guidance.code,
    reasonCode: guidance.reasonCode,
    title: interpolate(guidance.title, context),
    category: guidance.category,
    severity: guidance.severity,
    why: interpolateList(guidance.why, context),
    evidenceToCheck: interpolateList(guidance.evidenceToCheck, context),
    diagnostics: guidance.diagnostics.map((command) => interpolateCommand(command, context)),
    fixes: guidance.fixes.map((command) => interpolateCommand(command, context)),
    retry: {
      ...guidance.retry,
      stopWhen: interpolateList(guidance.retry.stopWhen, context),
    },
    escalation: {
      ...guidance.escalation,
      neededWhen: interpolateList(guidance.escalation.neededWhen, context),
      include: interpolateList(guidance.escalation.include, context),
    },
    safety: guidance.safety,
  };
}

function renderCommandList(commands: GuidanceCommand[], startAt = 1): string[] {
  return commands.map((command, index) => {
    const safety = command.mutates ? ' [changes state]' : ' [read-only]';
    const when = command.when ? ` — ${command.when}` : '';
    return `${startAt + index}. ${command.command}${safety}\n   ${command.purpose}${when}`;
  });
}

export function formatGuidanceText(
  guidance: ErrorGuidance,
  context?: Record<string, string>,
): string {
  const data = guidanceToJSON(guidance, context);
  const lines: string[] = [data.title, ''];

  if (data.why.length > 0) {
    lines.push('Why this might happen:');
    lines.push(...data.why.map((item) => `- ${item}`));
    lines.push('');
  }

  const nextSteps = [
    ...renderCommandList(data.diagnostics, 1),
    ...renderCommandList(data.fixes, data.diagnostics.length + 1),
  ];
  if (nextSteps.length > 0) {
    lines.push('Try next:');
    lines.push(...nextSteps);
    lines.push('');
  }

  if (data.retry.stopWhen.length > 0 || data.escalation.neededWhen.length > 0) {
    lines.push('Stop if:');
    lines.push(...data.retry.stopWhen.map((item) => `- ${item}`));
    lines.push(...data.escalation.neededWhen.map((item) => `- ${item}`));
    lines.push('');
  }

  if (data.escalation.include.length > 0) {
    lines.push(`Escalation evidence: ${data.escalation.include.join(', ')}`);
    lines.push('');
  }

  lines.push(`Error code: ${data.code}`);
  lines.push(`Reason: ${data.reasonCode}`);
  return lines.join('\n');
}

export function formatGuidanceExplanation(
  guidance: ErrorGuidance,
  context?: Record<string, string>,
): string {
  const data = guidanceToJSON(guidance, context);
  const lines = [
    `${data.code} — ${data.reasonCode}`,
    '',
    formatGuidanceText(guidance, context),
    '',
    `Category: ${data.category}`,
    `Severity: ${data.severity}`,
    `Public safe: ${data.safety.publicSafe ? 'yes' : 'no'}`,
  ];
  return lines.join('\n');
}


/**
 * eai user — manage users on the platform.
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { PlatformAPIClient } from '../lib/api.js';
import { resolveCommandContext } from '../lib/context.js';
import * as out from '../lib/output.js';

const TENANT_BASE_ROLES = [
  'tenant-viewer',
  'tenant-staff',
  'tenant-builder',
  'tenant-admin',
] as const;

const MEMBER_ID_ROLE_UPDATE_ROLES = ['member', 'tenant-admin'] as const;

interface UserCommandOptions {
  tenant?: string;
  format: string;
}

interface InviteUserCommandOptions extends UserCommandOptions {
  email: string;
  role: string;
  roleDefinitionId?: string;
  firstName?: string;
  lastName?: string;
  message?: string;
  redirectUri?: string;
}

interface ListUsersCommandOptions extends UserCommandOptions {
  page?: string;
  limit?: string;
  sort?: string;
  search?: string;
}

interface SetUserRoleCommandOptions extends UserCommandOptions {
  email?: string;
  memberId?: string;
  role: string;
}

interface TenantMember {
  id?: string;
  displayName?: string;
  email?: string;
  role?: string;
  roles?: string[];
  canRemove?: boolean;
}

interface TenantMemberListResponse {
  data?: TenantMember[];
  total?: number;
  page?: number;
  limit?: number;
  totalPages?: number;
}

interface TenantRoleDefinition {
  id?: string;
  label?: string;
  value?: string;
  baseRole?: string | null;
  isSystemRole?: boolean;
}

interface TenantRoleDefinitionResponse {
  data?: TenantRoleDefinition[];
  total?: number;
}

export const userCommand = new Command('user')
  .description('Manage users on the platform');

function assertTextOrJson(format: string): asserts format is 'text' | 'json' {
  if (!['text', 'json'].includes(format)) {
    out.error('Unsupported format. Use text or json.');
    process.exit(1);
  }
}

function isTenantBaseRole(role: string): boolean {
  return TENANT_BASE_ROLES.includes(role as (typeof TENANT_BASE_ROLES)[number]);
}

function isMemberIdRoleUpdateRole(role: string): boolean {
  return MEMBER_ID_ROLE_UPDATE_ROLES.includes(role as (typeof MEMBER_ID_ROLE_UPDATE_ROLES)[number]);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function memberRows(members: TenantMember[]): Array<[string, string]> {
  return members.map((member) => [
    member.email || member.id || '(unknown)',
    [
      member.displayName,
      member.roles?.length ? member.roles.join(', ') : member.role,
      member.canRemove === false ? 'protected' : undefined,
      member.id ? `id=${member.id}` : undefined,
    ].filter(Boolean).join(' | '),
  ]);
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  return await response.json() as T;
}

async function failResponse(
  response: Response,
  options: { jsonOutput: boolean; spinner?: ReturnType<typeof ora> | null; label: string; command: string; next?: string[] },
): Promise<never> {
  const body = await response.text();
  options.spinner?.fail(`${options.label}: ${response.status}: ${body}`);
  if (options.jsonOutput) {
    out.json({
      ok: false,
      status: response.status,
      error: body,
      command: options.command,
      ...(options.next ? { next: options.next } : {}),
    });
  }
  process.exit(1);
}

function validateInviteRole(options: InviteUserCommandOptions): void {
  if (options.roleDefinitionId) {
    return;
  }
  if (!isTenantBaseRole(options.role)) {
    out.error(`Unsupported role "${options.role}". Use one of: ${TENANT_BASE_ROLES.join(', ')}.`);
    out.info('Run `eai user roles --tenant <tenant-id> --format json` to see tenant role definitions.');
    process.exit(1);
  }
}

// ─── eai user invite ──────────────────────────────────────────────────────

userCommand
  .command('invite')
  .alias('add')
  .description('Invite or add a user to a tenant with a tenant role')
  .requiredOption('--email <email>', 'Email address of the user to add')
  .option('--tenant <id>', 'Tenant ID to add the user to (defaults to the active tenant)')
  .option('--role <role>', 'Tenant role to assign (tenant-viewer|tenant-staff|tenant-builder|tenant-admin)', 'tenant-viewer')
  .option('--role-definition-id <id>', 'Specific tenant role definition ID to assign instead of a base role')
  .option('--first-name <name>', 'Optional first name for new invitations')
  .option('--last-name <name>', 'Optional last name for new invitations')
  .option('--message <message>', 'Optional invitation message')
  .option('--redirect-uri <uri>', 'Optional post-invite redirect URI')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .addHelpText('after', `
Examples:
  $ eai user invite --email user@example.com --role tenant-viewer
  $ eai user invite --email user@example.com --tenant <tenant-id> --role tenant-admin
  $ eai user add --email user@example.com --role-definition-id <role-definition-id>

Use this command for normal tenant membership and role assignment. Do not use
tenant bootstrap-admin unless repairing first-admin access on an immediate child
tenant.
`)
  .action(async (options: InviteUserCommandOptions) => {
    assertTextOrJson(options.format);
    validateInviteRole(options);

    const ctx = await resolveCommandContext({ interactive: false });
    const tenantId = options.tenant || ctx.tenantId;

    const client = new PlatformAPIClient(ctx.publicApiUrl, tenantId);
    const jsonOutput = options.format === 'json';
    const requestedRole = options.roleDefinitionId ? `role definition ${options.roleDefinitionId}` : options.role;
    const inviteSpinner = jsonOutput
      ? null
      : ora(`Inviting ${options.email} to tenant ${tenantId} as ${requestedRole}...`).start();

    try {
      const inviteRes = await client.inviteTenantMember(tenantId, {
        email: options.email,
        role: options.roleDefinitionId ? undefined : options.role,
        roleDefinitionId: options.roleDefinitionId,
        firstName: options.firstName,
        lastName: options.lastName,
        message: options.message,
        redirectUri: options.redirectUri,
      });
      if (!inviteRes.ok) {
        await failResponse(inviteRes, {
          jsonOutput,
          spinner: inviteSpinner,
          label: 'Invite failed',
          command: 'eai user invite',
          next: [
            'Confirm you are tenant-admin for the target tenant with `eai whoami`.',
            'List allowed roles with `eai user roles --tenant <tenant-id> --format json`.',
            'Retry with an explicit role, for example `--role tenant-admin` or `--role tenant-viewer`.',
          ],
        });
      }

      const result = await inviteRes.json() as {
        email?: string;
        role?: string;
        status?: string;
        userId?: string;
        inviteMode?: string;
        message?: string;
      };
      if (jsonOutput) {
        out.json(result);
        return;
      }

      inviteSpinner?.succeed(
        `Invited ${chalk.cyan(result.email || options.email)} to tenant ${chalk.dim(tenantId)} as ${result.role || requestedRole}`,
      );
      if (result.message) {
        out.info(result.message);
      }
    } catch (err) {
      inviteSpinner?.fail(err instanceof Error ? err.message : String(err));
      if (jsonOutput) {
        out.json({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          command: 'eai user invite',
        });
      }
      process.exit(1);
    }
  });

// ─── eai user list ────────────────────────────────────────────────────────

userCommand
  .command('list')
  .description('List members in the active tenant or an explicit tenant')
  .option('--tenant <id>', 'Tenant ID to list members from (defaults to the active tenant)')
  .option('--search <query>', 'Search by email or name')
  .option('--page <number>', 'Page number', '1')
  .option('--limit <number>', 'Page size', '25')
  .option('--sort <field>', 'Sort field', 'email')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .action(async (options: ListUsersCommandOptions) => {
    assertTextOrJson(options.format);
    const ctx = await resolveCommandContext({ interactive: false });
    const tenantId = options.tenant || ctx.tenantId;
    const client = new PlatformAPIClient(ctx.publicApiUrl, tenantId);

    const response = await client.listTenantMembers(tenantId, {
      page: parsePositiveInt(options.page, 1),
      limit: parsePositiveInt(options.limit, 25),
      sort: options.sort || 'email',
      search: options.search,
    });
    if (!response.ok) {
      await failResponse(response, {
        jsonOutput: options.format === 'json',
        label: 'List members failed',
        command: 'eai user list',
      });
    }

    const result = await readJsonResponse<TenantMemberListResponse>(response);
    if (options.format === 'json') {
      out.json(result);
      return;
    }

    const members = result.data || [];
    out.heading(`Tenant members (${result.total ?? members.length})`);
    if (members.length === 0) {
      out.info('No members returned for this page.');
      return;
    }
    out.table(memberRows(members));
  });

// ─── eai user roles ───────────────────────────────────────────────────────

userCommand
  .command('roles')
  .description('List tenant role definitions available for user invitation')
  .option('--tenant <id>', 'Tenant ID to list roles from (defaults to the active tenant)')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .action(async (options: UserCommandOptions) => {
    assertTextOrJson(options.format);
    const ctx = await resolveCommandContext({ interactive: false });
    const tenantId = options.tenant || ctx.tenantId;
    const client = new PlatformAPIClient(ctx.publicApiUrl, tenantId);

    const response = await client.listTenantRoleDefinitions(tenantId);
    if (!response.ok) {
      await failResponse(response, {
        jsonOutput: options.format === 'json',
        label: 'List roles failed',
        command: 'eai user roles',
      });
    }

    const result = await readJsonResponse<TenantRoleDefinitionResponse>(response);
    if (options.format === 'json') {
      out.json(result);
      return;
    }

    const roles = result.data || [];
    out.heading(`Tenant roles (${result.total ?? roles.length})`);
    for (const role of roles) {
      out.info(`${role.value || role.id} — ${role.label || role.id}${role.baseRole ? ` (${role.baseRole})` : ''}`);
    }
  });

// ─── eai user role set ────────────────────────────────────────────────────

const userRoleCommand = userCommand
  .command('role')
  .description('Manage tenant member roles');

userRoleCommand
  .command('set')
  .description('Set a tenant member role; by email this uses the V4 invite/add flow')
  .option('--tenant <id>', 'Tenant ID to update (defaults to the active tenant)')
  .option('--email <email>', 'Email address to add or update through the invite/add flow')
  .option('--member-id <id>', 'Existing tenant member/user ID for the direct role update endpoint')
  .requiredOption('--role <role>', 'Role to assign. Email-based updates support tenant-viewer|tenant-staff|tenant-builder|tenant-admin; member-id updates support member|tenant-admin.')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .addHelpText('after', `
Examples:
  $ eai user role set --email user@example.com --role tenant-admin
  $ eai user role set --member-id <member-id> --role tenant-admin

For normal "add this person as tenant admin/member" requests, prefer email-based
commands because they can resolve existing users and create missing tenant
membership in one V4 flow.
`)
  .action(async (options: SetUserRoleCommandOptions) => {
    assertTextOrJson(options.format);
    if (!options.email && !options.memberId) {
      out.error('Provide --email or --member-id.');
      process.exit(1);
    }

    const ctx = await resolveCommandContext({ interactive: false });
    const tenantId = options.tenant || ctx.tenantId;
    const client = new PlatformAPIClient(ctx.publicApiUrl, tenantId);
    const jsonOutput = options.format === 'json';

    if (options.email) {
      if (!isTenantBaseRole(options.role)) {
        out.error(`Unsupported email-based role "${options.role}". Use one of: ${TENANT_BASE_ROLES.join(', ')}.`);
        process.exit(1);
      }
      const response = await client.inviteTenantMember(tenantId, {
        email: options.email,
        role: options.role,
      });
      if (!response.ok) {
        await failResponse(response, {
          jsonOutput,
          label: 'Role assignment failed',
          command: 'eai user role set',
          next: [
            'Confirm you are tenant-admin for the target tenant with `eai whoami`.',
            'List allowed roles with `eai user roles --tenant <tenant-id> --format json`.',
          ],
        });
      }
      const result = await readJsonResponse<unknown>(response);
      if (jsonOutput) {
        out.json(result);
      } else {
        out.success(`Assigned ${options.email} to ${options.role} in tenant ${tenantId}.`);
      }
      return;
    }

    if (!isMemberIdRoleUpdateRole(options.role)) {
      out.error(`Member-id role updates support ${MEMBER_ID_ROLE_UPDATE_ROLES.join(' or ')}. Use \`eai user invite --email <email> --role ${options.role}\` for email-based role assignment.`);
      process.exit(1);
    }

    const response = await client.updateTenantMemberRole(tenantId, options.memberId!, { role: options.role });
    if (!response.ok) {
      await failResponse(response, {
        jsonOutput,
        label: 'Role update failed',
        command: 'eai user role set',
      });
    }
    const result = await readJsonResponse<unknown>(response);
    if (jsonOutput) {
      out.json(result);
    } else {
      out.success(`Updated member ${options.memberId} to ${options.role} in tenant ${tenantId}.`);
    }
  });

// ─── eai user provision-me ────────────────────────────────────────────────────

userCommand
  .command('provision-me')
  .description('Provision yourself to a tenant (for first-time setup)')
  .option('--tenant <id>', 'Tenant ID to provision yourself to (defaults to the active tenant)')
  .action(async (options) => {
    const ctx = await resolveCommandContext({ interactive: false });
    const tenantId = options.tenant || ctx.tenantId;
    const client = new PlatformAPIClient(ctx.publicApiUrl, tenantId);

    const provisionSpinner = ora(`Provisioning you to tenant ${tenantId}...`).start();

    try {
      const provisionRes = await client.provisionMe();
      if (!provisionRes.ok) {
        const body = await provisionRes.text();
        provisionSpinner.fail(`Provisioning failed: ${provisionRes.status}: ${body}`);
        process.exit(1);
      }

      const result = await provisionRes.json() as { success?: boolean; message?: string; user?: unknown };
      provisionSpinner.succeed(
        `Successfully provisioned to tenant ${chalk.cyan(tenantId)}`,
      );

      if (result.message) {
        out.info(result.message);
      }
    } catch (err) {
      provisionSpinner.fail(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

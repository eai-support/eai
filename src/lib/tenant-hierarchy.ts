import inquirer from "inquirer";
import { PlatformAPIClient } from "./api.js";
import type { TenantEntry, TenantMembership } from "./tenant-context.js";

export interface TenantHierarchyItem {
  id: string;
  displayName: string;
  slug: string;
  domain?: string;
  isActive: boolean;
  roles: string[];
  homeRegion?: string | null;
  hqCountryCode?: string | null;
  parentId?: string | null;
  directMembership: boolean;
  children: TenantHierarchyItem[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function tenantReferenceId(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (!isRecord(value)) return null;
  return optionalString(value.id) ?? optionalString(value._id) ?? null;
}

function tenantParentIdFromRecord(record: Record<string, unknown>): string | null {
  return (
    tenantReferenceId(record.parentTenant) ??
    tenantReferenceId(record.parent) ??
    optionalString(record.parentTenantId) ??
    optionalString(record.parentId) ??
    optionalString(record.parent_tenant_id) ??
    null
  );
}

function tenantRecordsFromPayload(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord);
  }
  if (!isRecord(payload)) return [];

  for (const key of ["children", "tenants", "docs", "items", "data"]) {
    const value = payload[key];
    if (Array.isArray(value)) {
      return value.filter(isRecord);
    }
  }

  if (isRecord(payload.tenant)) {
    return [payload.tenant];
  }
  return [];
}

function tenantHierarchyItemFromMembership(
  membership: TenantMembership,
): TenantHierarchyItem {
  return {
    id: membership.id,
    displayName: membership.displayName,
    slug: membership.slug,
    domain: membership.domain,
    isActive: membership.isActive,
    roles: membership.roles,
    parentId: membership.parentId,
    homeRegion: membership.homeRegion,
    hqCountryCode: membership.hqCountryCode,
    directMembership: true,
    children: [],
  };
}

function tenantHierarchyItemFromRecord(
  record: Record<string, unknown>,
): TenantHierarchyItem | null {
  const id = optionalString(record.id) ?? optionalString(record._id);
  if (!id) return null;

  const slug = optionalString(record.slug) ?? id;
  const displayName =
    optionalString(record.displayName) ??
    optionalString(record.name) ??
    optionalString(record.title) ??
    slug;

  return {
    id,
    displayName,
    slug,
    domain: optionalString(record.domain),
    isActive: record.isActive !== false,
    roles: [],
    homeRegion:
      typeof record.homeRegion === "string" || record.homeRegion === null
        ? record.homeRegion
        : undefined,
    hqCountryCode:
      typeof record.hqCountryCode === "string" || record.hqCountryCode === null
        ? record.hqCountryCode
        : undefined,
    parentId: tenantParentIdFromRecord(record),
    directMembership: false,
    children: [],
  };
}

function mergeTenantHierarchyItem(
  existing: TenantHierarchyItem | undefined,
  next: TenantHierarchyItem,
): TenantHierarchyItem {
  if (!existing) return next;

  return {
    ...existing,
    ...next,
    displayName: next.displayName || existing.displayName,
    slug: next.slug || existing.slug,
    domain: next.domain ?? existing.domain,
    roles: existing.roles.length ? existing.roles : next.roles,
    directMembership: existing.directMembership || next.directMembership,
    parentId: next.parentId ?? existing.parentId,
    homeRegion: next.homeRegion ?? existing.homeRegion,
    hqCountryCode: next.hqCountryCode ?? existing.hqCountryCode,
    children: [],
  };
}

function compareTenantHierarchyItems(
  left: TenantHierarchyItem,
  right: TenantHierarchyItem,
): number {
  return left.displayName.localeCompare(right.displayName, undefined, {
    sensitivity: "base",
  });
}

export function tenantMatchesParent(
  entry: TenantEntry,
  parentId: string,
): boolean {
  const parent = entry.tenant.parent;
  const resolvedParentId =
    typeof parent === "string" ? parent : (parent?.id ?? entry.tenant.parentId);
  return resolvedParentId === parentId || entry.tenant.id === parentId;
}

export function buildTenantHierarchy(
  directMemberships: TenantMembership[],
  childRecords: unknown[] = [],
): TenantHierarchyItem[] {
  const byId = new Map<string, TenantHierarchyItem>();

  for (const membership of directMemberships) {
    byId.set(
      membership.id,
      mergeTenantHierarchyItem(
        byId.get(membership.id),
        tenantHierarchyItemFromMembership(membership),
      ),
    );
  }

  for (const record of childRecords) {
    if (!isRecord(record)) continue;
    const item = tenantHierarchyItemFromRecord(record);
    if (!item) continue;
    byId.set(item.id, mergeTenantHierarchyItem(byId.get(item.id), item));
  }

  for (const item of byId.values()) {
    item.children = [];
  }

  const roots: TenantHierarchyItem[] = [];
  for (const item of byId.values()) {
    if (item.parentId && item.parentId !== item.id && byId.has(item.parentId)) {
      byId.get(item.parentId)!.children.push(item);
    } else {
      roots.push(item);
    }
  }

  const sortTree = (items: TenantHierarchyItem[]): TenantHierarchyItem[] => {
    items.sort(compareTenantHierarchyItems);
    for (const item of items) {
      sortTree(item.children);
    }
    return items;
  };

  return sortTree(roots);
}

export function flattenTenantHierarchy(
  roots: TenantHierarchyItem[],
): TenantHierarchyItem[] {
  const items: TenantHierarchyItem[] = [];
  const visit = (item: TenantHierarchyItem): void => {
    items.push(item);
    for (const child of item.children) visit(child);
  };
  for (const root of roots) visit(root);
  return items;
}

function tenantHierarchyStatus(
  item: TenantHierarchyItem,
  activeTenantId?: string,
): string {
  const labels: string[] = [];
  if (item.roles.length) labels.push(item.roles.join(", "));
  if (!item.directMembership) labels.push("visible via parent");
  if (activeTenantId === item.id) labels.push("active");
  return labels.length ? ` [${labels.join("; ")}]` : "";
}

export function tenantHierarchyLineText(
  item: TenantHierarchyItem,
  prefix: string,
  isLast: boolean,
  isRoot: boolean,
  activeTenantId?: string,
): string {
  const connector = isRoot ? "" : isLast ? "`- " : "|- ";
  const domain = item.domain ? ` (${item.domain})` : "";
  return `${prefix}${connector}${item.slug} - ${item.displayName}${domain}${tenantHierarchyStatus(item, activeTenantId)}`;
}

export function buildTenantHierarchyTreeLines(
  roots: TenantHierarchyItem[],
  options?: { activeTenantId?: string },
): string[] {
  const lines: string[] = [];
  const visit = (
    item: TenantHierarchyItem,
    prefix: string,
    isLast: boolean,
    isRoot: boolean,
  ): void => {
    lines.push(
      tenantHierarchyLineText(
        item,
        prefix,
        isLast,
        isRoot,
        options?.activeTenantId,
      ),
    );
    const childPrefix = isRoot ? "" : `${prefix}${isLast ? "   " : "|  "}`;
    item.children.forEach((child, index) =>
      visit(child, childPrefix, index === item.children.length - 1, false),
    );
  };

  roots.forEach((root, index) =>
    visit(root, "", index === roots.length - 1, true),
  );
  return lines;
}

export function tenantHierarchyJson(
  item: TenantHierarchyItem,
): Record<string, unknown> {
  return {
    id: item.id,
    displayName: item.displayName,
    slug: item.slug,
    domain: item.domain,
    isActive: item.isActive,
    roles: item.roles,
    homeRegion: item.homeRegion,
    hqCountryCode: item.hqCountryCode,
    parentId: item.parentId,
    directMembership: item.directMembership,
    children: item.children.map(tenantHierarchyJson),
  };
}

export async function loadTenantHierarchy(options: {
  publicApiUrl: string;
  memberships: TenantMembership[];
  parentId?: string;
  debug?: (message: string, data?: unknown) => void;
}): Promise<{ roots: TenantHierarchyItem[]; warnings: string[] }> {
  const warnings: string[] = [];
  const childRecords: Record<string, unknown>[] = [];
  const parentMembership = options.parentId
    ? options.memberships.find(
        (membership) =>
          membership.id === options.parentId || membership.slug === options.parentId,
      )
    : undefined;
  const rootMemberships = options.parentId
    ? [
        parentMembership ??
          ({
            id: options.parentId,
            displayName: options.parentId,
            slug: options.parentId,
            isActive: true,
            roles: [],
          } satisfies TenantMembership),
      ]
    : options.memberships;
  const parentsToQuery = options.parentId ? [options.parentId] : [];

  for (const parentId of parentsToQuery) {
    const client = new PlatformAPIClient(options.publicApiUrl, parentId);
    try {
      const response = await client.listTenantChildren(parentId, {
        includeDescendants: true,
        limit: 100,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        const message =
          `Could not load child tenants for ${parentId}: ${response.status} ${response.statusText}`.trim();
        warnings.push(message);
        options.debug?.(message, body || undefined);
        continue;
      }
      childRecords.push(...tenantRecordsFromPayload(await response.json()));
    } catch (error) {
      const message =
        error instanceof Error
          ? `Could not load child tenants for ${parentId}: ${error.message}`
          : `Could not load child tenants for ${parentId}`;
      warnings.push(message);
      options.debug?.(message);
    }
  }

  return {
    roots: buildTenantHierarchy(rootMemberships, childRecords),
    warnings,
  };
}

export async function promptForTenantFromHierarchy(
  roots: TenantHierarchyItem[],
  options?: {
    message?: string;
    allowIndirect?: boolean;
    extraChoices?: Array<{ name: string; value: string; disabled?: string }>;
  },
): Promise<string> {
  const choices: Array<{ name: string; value: string; disabled?: string }> = [];
  const allowIndirect = options?.allowIndirect ?? false;
  const visit = (
    item: TenantHierarchyItem,
    prefix: string,
    isLast: boolean,
    isRoot: boolean,
  ): void => {
    choices.push({
      name: tenantHierarchyLineText(item, prefix, isLast, isRoot),
      value: item.id,
      disabled:
        allowIndirect || item.directMembership
          ? undefined
          : "Visible through parent hierarchy; direct tenant-admin membership is required to select.",
    });
    const childPrefix = isRoot ? "" : `${prefix}${isLast ? "   " : "|  "}`;
    item.children.forEach((child, index) =>
      visit(child, childPrefix, index === item.children.length - 1, false),
    );
  };
  roots.forEach((root, index) =>
    visit(root, "", index === roots.length - 1, true),
  );
  if (options?.extraChoices?.length) {
    choices.push(...options.extraChoices);
  }

  const { tenantId } = await inquirer.prompt([
    {
      type: "select",
      name: "tenantId",
      message: options?.message ?? "Select the tenant to work with now",
      choices,
    },
  ]);
  return String(tenantId);
}

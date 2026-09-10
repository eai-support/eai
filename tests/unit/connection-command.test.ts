import { describe, expect, it } from "vitest";

import {
  boundedWaitTimeoutMs,
  buildConnectionCreatePayload,
  buildConnectionListSuffix,
  connectionRowsForOutput,
  connectionCommand,
  regionalActivationFromResult,
  resultForOutput,
  waitForRegionalActivation,
} from "../../src/commands/connection.js";

describe("connection command", () => {
  it("builds a least-privilege Standard API Key request", () => {
    expect(
      buildConnectionCreatePayload({
        name: "Nightly finance",
        ownerName: "Finance Platform",
        ownerEmail: "finance@example.com",
        model: "api-key",
        action: ["read"],
        objectType: ["invoice", "invoice"],
        allowedCidr: ["203.0.113.0/24"],
        revealKey: true,
      }),
    ).toEqual({
      name: "Nightly finance",
      securityModel: "api-key",
      owner: { name: "Finance Platform", email: "finance@example.com" },
      capabilities: { actions: ["read"], objectTypes: ["invoice"] },
      accessMode: "custom",
      allowedCidrs: ["203.0.113.0/24"],
    });
  });

  it.each(["tenant-admin", "tenant-member"] as const)(
    "builds one governed %s role without a parallel Custom grant",
    (accessMode) => {
      const payload = buildConnectionCreatePayload({
        name: "Governed app",
        ownerName: "App Team",
        ownerEmail: "apps@example.com",
        model: "api-key",
        accessMode,
        confirmTenantAdmin: accessMode === "tenant-admin",
        action: ["read"],
        objectType: [],
        allowedCidr: [],
        revealKey: true,
      });
      expect(payload).toMatchObject({
        accessMode,
        tenantRoleGrant: { role: accessMode, roleContractVersion: 1 },
      });
      expect(payload).not.toHaveProperty("capabilities");
    },
  );

  it("requires explicit confirmation for Tenant Administrator", () => {
    expect(() =>
      buildConnectionCreatePayload({
        name: "Administrator app",
        ownerName: "App Team",
        ownerEmail: "apps@example.com",
        model: "api-key",
        accessMode: "tenant-admin",
        action: ["read"],
        objectType: [],
        allowedCidr: [],
        revealKey: true,
      }),
    ).toThrow(/confirm-tenant-admin/i);
  });

  it("requires the exact customer Entra identity for Advanced Security", () => {
    expect(() =>
      buildConnectionCreatePayload({
        name: "Federated reporting",
        ownerName: "Identity Team",
        ownerEmail: "identity@example.com",
        model: "advanced",
        action: ["query"],
        objectType: ["invoice"],
        allowedCidr: [],
      }),
    ).toThrow(/directory-tenant-id.*client-id/i);
  });

  it("refuses to issue a Standard key unless one-time reveal is explicit", () => {
    expect(() =>
      buildConnectionCreatePayload({
        name: "Nightly finance",
        ownerName: "Finance Platform",
        ownerEmail: "finance@example.com",
        model: "api-key",
        action: ["read"],
        objectType: ["invoice"],
        allowedCidr: [],
      }),
    ).toThrow(/requires --reveal-key/i);
  });

  it("publishes the complete lifecycle as named subcommands", () => {
    expect(connectionCommand.alias()).toBe("connections");
    expect(connectionCommand.commands.map((command) => command.name())).toEqual(
      [
        "list",
        "get",
        "create",
        "update",
        "activate",
        "suspend",
        "revoke",
        "rotate-key",
      ],
    );
  });

  it("offers bounded regional activation waiting on reads and every mutation", () => {
    for (const name of [
      "get",
      "create",
      "update",
      "activate",
      "suspend",
      "revoke",
      "rotate-key",
    ]) {
      const command = connectionCommand.commands.find(
        (candidate) => candidate.name() === name,
      );
      expect(command?.options.map((option) => option.long)).toEqual(
        expect.arrayContaining(["--wait", "--wait-timeout-seconds"]),
      );
    }
    expect(boundedWaitTimeoutMs()).toBe(60_000);
    expect(boundedWaitTimeoutMs("600")).toBe(600_000);
    expect(() => boundedWaitTimeoutMs("0")).toThrow(/1 to 600/);
    expect(() => boundedWaitTimeoutMs("601")).toThrow(/1 to 600/);
  });

  it("waits for explicit all-region proof instead of treating save as success", async () => {
    let clock = 0;
    const states = [
      {
        regionalActivation: {
          state: "activating",
          confirmedRegionCount: 2,
          requiredRegionCount: 3,
          pollAfterSeconds: 1,
        },
      },
      {
        regionalActivation: {
          state: "active",
          confirmedRegionCount: 3,
          requiredRegionCount: 3,
        },
      },
    ];

    const activation = await waitForRegionalActivation({
      initialResult: {
        connection: {
          id: "connection-1",
          status: "active",
          regionalActivation: { state: "saved", pollAfterSeconds: 1 },
        },
      },
      poll: async () => states.shift()!,
      timeoutMs: 5_000,
      now: () => clock,
      sleep: async (milliseconds) => {
        clock += milliseconds;
      },
    });

    expect(activation).toMatchObject({
      state: "active",
      confirmedRegionCount: 3,
      requiredRegionCount: 3,
    });
  });

  it("returns incomplete and non-zero semantics when the bounded wait expires", async () => {
    let clock = 0;
    await expect(
      waitForRegionalActivation({
        initialResult: {
          regionalActivation: {
            state: "activating",
            pollAfterSeconds: 1,
          },
        },
        poll: async () => ({
          regionalActivation: {
            state: "activating",
            pollAfterSeconds: 1,
          },
        }),
        timeoutMs: 2_000,
        now: () => clock,
        sleep: async (milliseconds) => {
          clock += milliseconds;
        },
      }),
    ).rejects.toThrow(/incomplete.*saved.*not confirmed active/i);
  });

  it("reports an unavailable activation endpoint as saved but incomplete", async () => {
    await expect(
      waitForRegionalActivation({
        initialResult: { regionalActivation: { state: "saved" } },
        poll: async () => {
          throw new Error("404 Not Found");
        },
        timeoutMs: 5_000,
        sleep: async () => undefined,
      }),
    ).rejects.toThrow(/could not be confirmed.*saved.*incomplete/i);
  });

  it("does not invent regional readiness for legacy responses", () => {
    expect(
      regionalActivationFromResult({
        connection: { id: "connection-1", status: "active" },
      }),
    ).toBeNull();
    expect(() =>
      regionalActivationFromResult({
        regionalActivation: { state: "delivered" },
      }),
    ).toThrow(/unsupported state/i);
  });

  it("hides a one-time key unless the administrator explicitly reveals it", () => {
    const result = {
      connection: { id: "connection-1" },
      oneTimeCredential: { apiKey: "eai_prod_public-secret" },
    };

    expect(resultForOutput(result)).toEqual({
      connection: { id: "connection-1" },
    });
    expect(resultForOutput(result, true)).toBe(result);
  });

  it("renders every connection from the PublicAPI list envelope", () => {
    const connections = [
      {
        id: "connection-1",
        name: "Nightly finance",
        securityModel: "api-key",
        status: "active",
      },
      {
        id: "connection-2",
        name: "Warehouse sync",
        securityModel: "advanced",
        status: "suspended",
      },
    ];

    expect(connectionRowsForOutput({ connections, total: 2 })).toEqual(
      connections,
    );
  });

  it("builds a bounded page request so large tenants can reach every connection", () => {
    expect(buildConnectionListSuffix({ page: "2", limit: "25" })).toBe(
      "?page=2&limit=25",
    );
    expect(() => buildConnectionListSuffix({ page: "0", limit: "25" })).toThrow(
      /--page/,
    );
    expect(() =>
      buildConnectionListSuffix({ page: "1", limit: "101" }),
    ).toThrow(/--limit/);
  });
});

import { describe, expect, it } from "vitest";

import {
  buildConnectionCreatePayload,
  buildConnectionListSuffix,
  connectionRowsForOutput,
  connectionCommand,
  resultForOutput,
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
      allowedCidrs: ["203.0.113.0/24"],
    });
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

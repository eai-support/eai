import { describe, expect, test } from 'vitest';
import { capabilityCommand, diagnoseCapabilityConnections } from '../../src/commands/capability.js';

describe('eai capability command schema', () => {
  test('exposes discovery, status, governed setup guidance, and four-state doctor commands', () => {
    expect(capabilityCommand.commands.map((command) => command.name())).toEqual([
      'list',
      'status',
      'setup',
      'doctor',
    ]);
    expect(capabilityCommand.commands.find((command) => command.name() === 'setup')?.description())
      .toMatch(/without changing credentials/);
  });

  test('keeps tenant-wide inventory informational while explicit checks remain strict', () => {
    const connections = [
      { capabilityKey: 'ai.chat', entitled: true, configured: true, bound: true, runtimeReady: true },
      { capabilityKey: 'integrations.billing.stripe', entitled: false, configured: false, bound: false, runtimeReady: false },
    ];

    expect(diagnoseCapabilityConnections(connections, false)).toEqual({ gateApplied: false, ready: null });
    expect(diagnoseCapabilityConnections(connections.slice(0, 1), true)).toEqual({ gateApplied: true, ready: true });
    expect(diagnoseCapabilityConnections(connections.slice(1), true)).toEqual({ gateApplied: true, ready: false });
  });
});

import { Command } from 'commander';
import { registerAssetCrudCommands } from './control-plane-assets.js';

export const aiCommand = new Command('ai')
  .description('Manage tenant AI control-plane assets');

const profileCommand = new Command('profile')
  .description('Manage AI model profiles through typed PublicAPI operations');

registerAssetCrudCommands(profileCommand, {
  kind: 'ai-profile',
  keyField: 'profileKey',
  displayName: 'AI profile',
  defaultCapability: 'ai.chat',
});

aiCommand.addCommand(profileCommand);

import { Command } from 'commander';
import { registerAssetCrudCommands } from './control-plane-assets.js';

export const promptCommand = new Command('prompt')
  .description('Manage tenant prompts through typed PublicAPI operations');

registerAssetCrudCommands(promptCommand, {
  kind: 'prompt',
  keyField: 'configKey',
  displayName: 'prompt',
  defaultCapability: 'ai.chat',
});

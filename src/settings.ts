import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI } from './pro';
import type TbxTermImportPlugin from './main';
import { helloSettingItems } from './hello/settings';
export interface TbxTermImportSettings { title: string }
export const DEFAULT_SETTINGS: TbxTermImportSettings = { title: 'Glossary' };
export function normalizeSettings(saved: Partial<TbxTermImportSettings> | null | undefined): TbxTermImportSettings {
 return { title: typeof saved?.title === 'string' && saved.title.trim() ? saved.title.trim().slice(0, 120) : DEFAULT_SETTINGS.title };
}
export class TbxTermImportSettingTab extends PluginSettingTab {
 constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], public plugin: TbxTermImportPlugin) { super(app, plugin); }
 getSettingDefinitions(): SettingDefinitionItem[] {
 	// The product rows, then the "More from NoteMods" card (packages/hello).
 	return [...this.productSettingDefinitions(), ...helloSettingItems()];
 }

 productSettingDefinitions(): SettingDefinitionItem[] {
  return [
   { name: 'New glossary name', desc: 'The proposed note name. The importer adds a number if the name exists.', control: { type: 'text', key: 'title', defaultValue: DEFAULT_SETTINGS.title } },
   ...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
  ];
 }
 async setControlValue(key: string, value: unknown): Promise<void> {
  await super.setControlValue(key, value);
  this.plugin.settings = normalizeSettings(this.plugin.settings);
  await this.plugin.saveSettings();
 }
}

import { Plugin, normalizePath, type TFile } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { bindPro, isPro, resetPro, SPONSORS, proNotice } from './pro';
import { DEFAULT_SETTINGS, normalizeSettings, TbxTermImportSettingTab, type TbxTermImportSettings } from './settings';
import { ImportModal, type ImportMode } from './modal';
import { freePath, renderGlossary, type Glossary, type Preview, type Change } from './reader';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

export default class TbxTermImportPlugin extends Plugin {
 settings: TbxTermImportSettings = { ...DEFAULT_SETTINGS };
 pro: SponsorsManager | null = null;
 readonly modals = new Set<ImportModal>();
 async onload(): Promise<void> {
   // First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
   setupHello(this, WHATS_NEW);
  await this.loadSettings();
  const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
  this.pro = pro;
  pro.init();
  bindPro(pro);
  const tab = new TbxTermImportSettingTab(this.app, this);
  this.addSettingTab(tab);
  this.register(pro.onChange(() => tab.update()));
  this.addCommand({ id: 'import-file', name: 'Import a local term file', callback: () => { this.openImport('single'); } });
  this.addCommand({ id: 'import-batch', name: 'Import several local term files (pro)', callback: () => { this.openImport('batch'); } });
  this.addCommand({ id: 'merge-file', name: 'Merge a later term import (pro)', callback: () => { this.openImport('merge'); } });
  this.app.workspace.onLayoutReady(() => {
   void pro.refresh();
   this.registerInterval(window.setInterval(() => void pro.refresh(), 6 * 60 * 60 * 1000));
  });
 }
 onunload(): void {
  for (const modal of this.modals) modal.close();
  resetPro();
 }
 openImport(mode: ImportMode = 'single'): ImportModal | null {
  if (mode !== 'single' && !isPro()) {
   proNotice('This is a pro feature.');
   return null;
  }
  const modal = new ImportModal(this, mode);
  this.modals.add(modal);
  modal.open();
  return modal;
 }
 async loadSettings(): Promise<void> {
  this.settings = normalizeSettings(await this.loadData() as Partial<TbxTermImportSettings> | null);
 }
 async saveSettings(): Promise<void> { await this.saveData(this.settings); }
 async writeGlossary(title: string, filename: string, report: Preview, mode: ImportMode, glossary: Glossary = report, changes: Change[] = []): Promise<TFile> {
  if (mode !== 'single' && !isPro()) throw new Error('Pro is required for batch import and merge.');
  if (!report.rows.length) throw new Error('There are no supported rows in the selected languages.');
  const path = normalizePath(freePath(title, (p) => !!this.app.vault.getAbstractFileByPath(normalizePath(p))));
  return this.app.vault.create(path, renderGlossary(glossary, filename, report.skipped, report.warnings, changes));
 }
}

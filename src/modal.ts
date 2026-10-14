import { FuzzySuggestModal, Modal, Notice, type TFile } from 'obsidian';
import type TbxTermImportPlugin from './main';
import { isPro, onProChange } from './pro';
import { preview, readTbx, readLocalFile, readGlossary, mergeGlossary, type Parsed, type Preview, type Glossary, type Change } from './reader';

export type ImportMode = 'single' | 'batch' | 'merge';
interface Loaded { name: string; parsed: Parsed | null; error: string }
interface Plan { name: string; report: Preview; glossary: Glossary; changes: Change[] }

class GlossaryPicker extends FuzzySuggestModal<TFile> {
	constructor(private plugin: TbxTermImportPlugin, private choose: (file: TFile) => void) { super(plugin.app); }
	getItems(): TFile[] { return this.plugin.app.vault.getFiles().filter((f) => f.extension === 'md'); }
	getItemText(file: TFile): string { return file.path; }
	onChooseItem(file: TFile): void { this.choose(file); }
}

export class ImportModal extends Modal {
	private loaded: Loaded[] = [];
	private plans: Plan[] = [];
	private previous: Glossary | null = null;
	private previousPath = '';
	private area!: HTMLElement;
	private source!: HTMLSelectElement;
	private target!: HTMLSelectElement;
	private title!: HTMLInputElement;
	private create!: HTMLButtonElement;
	private baseLabel!: HTMLElement;
	private result!: HTMLElement;
	private fileInput!: HTMLInputElement;
	private busy = false;
	private closed = false;
	private generation = 0;
	private off: (() => void) | null = null;

	constructor(private plugin: TbxTermImportPlugin, readonly mode: ImportMode) { super(plugin.app); }

	onOpen(): void {
		this.closed = false;
		this.modalEl.addClass('tbx-term-import-modal');
		this.setTitle(this.mode === 'single' ? 'Import a local term file' : this.mode === 'batch' ? 'Import several local term files (Pro)' : 'Review a later import (Pro)');
		const el = this.contentEl;
		el.createEl('p', { text: 'Supports v2 concept records, language sets and simple or grouped terms. UTF-8 only, up to 4194304 bytes and 10000 records per file. Document types, entities and v3 concept records are refused before import.' });
		const label = el.createEl('label', { text: this.mode === 'batch' ? 'Local term files' : 'Local term file', cls: 'tbx-field' });
		this.fileInput = label.createEl('input', { attr: { type: 'file', accept: '.tbx,.xml', 'data-tbx': 'file' } });
		this.fileInput.multiple = this.mode === 'batch';
		this.fileInput.addEventListener('change', () => { void this.loadFiles(Array.from(this.fileInput.files ?? [])); });
		const controls = el.createDiv({ cls: 'tbx-controls' });
		this.source = controls.createEl('label', { text: 'Source language label', cls: 'tbx-field' }).createEl('select', { attr: { 'data-tbx': 'source' } });
		this.target = controls.createEl('label', { text: 'Target language label', cls: 'tbx-field' }).createEl('select', { attr: { 'data-tbx': 'target' } });
		this.source.addEventListener('change', () => this.refresh());
		this.target.addEventListener('change', () => this.refresh());
		this.title = el.createEl('label', { text: 'New note name in the vault root', cls: 'tbx-field' }).createEl('input', { attr: { type: 'text', 'data-tbx': 'title' } });
		this.title.value = this.plugin.settings.title;
		if (this.mode === 'merge') {
			const pick = el.createEl('button', { text: 'Choose prior glossary', attr: { 'data-tbx': 'choose-base' } });
			pick.addEventListener('click', () => new GlossaryPicker(this.plugin, (file) => { void this.setPrevious(file); }).open());
			this.baseLabel = el.createEl('p', { text: 'Choose a prior glossary created by this importer. The merge uses its local merge data.' });
		}
		this.area = el.createDiv({ cls: 'tbx-preview', attr: { 'data-tbx': 'preview' } });
		this.area.createEl('p', { text: 'Choose a local file to see its records. No output note exists until you select create glossary.' });
		this.create = el.createEl('button', { text: this.mode === 'merge' ? 'Create reviewed merge' : 'Create glossary', cls: 'mod-cta', attr: { 'data-tbx': 'create' } });
		this.create.disabled = true;
		this.create.addEventListener('click', () => { void this.save(); });
		this.result = el.createEl('p', { attr: { 'data-tbx': 'result', role: 'status' } });
		this.off = onProChange(() => { if (!this.closed) this.refresh(); });
	}

	async loadFiles(files: File[]): Promise<void> {
		if (this.busy || this.closed) return;
		const generation = ++this.generation;
		this.create.disabled = true;
		this.loaded = [];
		this.plans = [];
		if (this.mode !== 'batch' && files.length > 1) { this.refresh(); this.result.textContent = 'Choose one local file in this mode.'; return; }
		if (files.length > 20) { this.refresh(); this.result.textContent = 'Choose up to 20 files per batch.'; return; }
		this.result.textContent = 'Reading local files.';
		const loaded: Loaded[] = [];
		for (const file of files) {
			try { loaded.push({ name: file.name, parsed: readTbx(await readLocalFile(file)), error: '' }); }
			catch (e) { loaded.push({ name: file.name, parsed: null, error: message(e) }); }
		}
		if (this.closed || generation !== this.generation) return;
		this.loaded = loaded;
		const languages = [...new Set(loaded.flatMap((f) => f.parsed?.languages ?? []))];
		for (const select of [this.source, this.target]) {
			select.empty();
			for (const lang of languages) select.createEl('option', { text: lang, value: lang });
		}
		this.source.value = this.previous?.source ?? languages[0] ?? '';
		this.target.value = this.previous?.target ?? languages[1] ?? '';
		this.result.textContent = '';
		this.refresh();
	}

	async setPrevious(file: TFile): Promise<void> {
		if (this.busy || this.closed) return;
		try {
			const prior = readGlossary(await this.app.vault.cachedRead(file));
			if (this.closed) return;
			this.previous = prior;
			this.previousPath = file.path;
			this.baseLabel.textContent = `Prior glossary: ${file.path}. The prior note stays unchanged.`;
			if (this.loaded.length) { this.source.value = prior.source; this.target.value = prior.target; }
		} catch (e) { this.previous = null; this.baseLabel.textContent = message(e); }
		this.refresh();
	}

	refresh(): void {
		this.plans = [];
		this.area.empty();
		if (this.mode === 'batch' && this.loaded.length) this.area.createEl('p', { text: `${this.loaded.length} local files: ${this.loaded.map((f) => f.name).join(', ')}` });
		for (const file of this.loaded) {
			this.area.createEl('p', { text: file.name, cls: 'tbx-file-name' });
			try {
				if (!file.parsed) throw new Error(file.error);
				const report = preview(file.parsed, this.source.value, this.target.value);
				let glossary: Glossary = report;
				let changes: Change[] = [];
				if (this.mode === 'merge') {
					if (!this.previous) throw new Error('Choose a prior glossary to review the merge.');
					({ glossary, changes } = mergeGlossary(this.previous, report));
				}
				this.showRows(report);
				if (changes.length) this.showChanges(changes);
				if (report.rows.length && (this.mode !== 'merge' || changes.length <= 100)) this.plans.push({ name: file.name, report, glossary, changes });
				else this.area.createEl('p', { text: 'No output note will be created. A merge review is limited to 100 rows.' });
			} catch (e) { this.area.createEl('p', { text: message(e), cls: 'tbx-error' }); }
		}
		this.create.disabled = this.busy || !this.plans.length || (this.mode !== 'single' && !isPro());
	}

	private showRows(report: Preview): void {
		this.area.createEl('p', { text: `${report.rows.length} rows. ${report.skipped.length} skipped records or structures. ${report.warnings.length} missing language labels.` });
		const table = this.area.createEl('table');
		const head = table.createEl('thead').createEl('tr');
		for (const text of ['Concept ID', report.source, report.target, 'Definitions', 'Status']) head.createEl('th', { text });
		const body = table.createEl('tbody');
		for (const r of report.rows.slice(0, 100)) {
			const tr = body.createEl('tr', { attr: { 'data-concept': r.id } });
			for (const text of [r.id, r.source.join('\n'), r.target.join('\n'), r.definitions.join('\n'), r.missing.length ? 'Missing ' + r.missing.join(', ') : 'Ready']) tr.createEl('td', { text });
		}
		if (report.rows.length > 100) this.area.createEl('p', { text: 'Preview shows the first 100 rows. The output includes the selected supported rows.' });
		for (const [title, items] of [['Skipped records', report.skipped], ['Missing languages', report.warnings]] as const) {
			this.area.createEl('p', { text: title });
			const list = this.area.createEl('ul');
			for (const text of items.slice(0, 100)) list.createEl('li', { text });
			if (!items.length) list.createEl('li', { text: 'None.' });
			if (items.length > 100) list.createEl('li', { text: 'More entries appear in the output report.' });
		}
	}

	private showChanges(changes: Change[]): void {
		this.area.createEl('p', { text: `Merge review for ${this.previousPath}: ${changes.filter((c) => c.kind === 'added').length} added, ${changes.filter((c) => c.kind === 'changed').length} changed. Absent prior concepts are retained.` });
		const table = this.area.createEl('table', { attr: { 'data-tbx': 'changes' } });
		const header = table.createEl('thead').createEl('tr');
		for (const text of ['Concept ID', 'Change', 'Before', 'After']) header.createEl('th', { text });
		const summary = (r: Change['before']) => r ? `${r.source.join('; ')} → ${r.target.join('; ')}\n${r.definitions.join('\n')}\n${r.missing.join(', ')}` : 'No prior row';
		for (const change of changes.slice(0, 100)) {
			const row = table.createEl('tr');
			for (const text of [change.id, change.kind, summary(change.before), summary(change.after)]) row.createEl('td', { text });
		}
		if (changes.length > 100) this.area.createEl('p', { text: 'The review exceeds 100 rows. Reduce the source or prior glossary before merge.' });
	}

	async save(): Promise<void> {
		if (this.busy || this.closed || !this.plans.length) return;
		this.busy = true;
		this.create.disabled = true;
		this.fileInput.disabled = this.source.disabled = this.target.disabled = this.title.disabled = true;
		const outputs: string[] = [];
		const failed: Plan[] = [];
		for (const plan of this.plans) {
			if (this.closed) break;
			try {
				const file = await this.plugin.writeGlossary(this.title.value, plan.name, plan.report, this.mode, plan.glossary, plan.changes);
				outputs.push(`Created ${file.path}.`);
			} catch (e) { outputs.push(`${plan.name}: ${message(e)}`); failed.push(plan); }
		}
		this.plans = failed;
		this.busy = false;
		if (!this.closed) {
			this.fileInput.disabled = this.source.disabled = this.target.disabled = this.title.disabled = false;
			this.create.disabled = !failed.length || (this.mode !== 'single' && !isPro());
			this.result.textContent = outputs.join(' ');
			new Notice(outputs.join(' '));
		}
	}

	onClose(): void {
		this.closed = true;
		this.generation++;
		this.off?.();
		this.off = null;
		this.plugin.modals.delete(this);
		this.contentEl.empty();
	}
}

function message(e: unknown): string { return e instanceof Error ? e.message : String(e); }

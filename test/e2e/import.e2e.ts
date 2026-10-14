import { browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { pluginId, reloadPlugin } from './load';
import type TbxTermImportPlugin from '../../src/main';

const xml = readFileSync('docs/sample-notes/Pump terms.tbx', 'utf8');
const later = readFileSync('docs/sample-notes/Later terms.tbx', 'utf8');

async function closeModals(): Promise<void> {
	await browser.executeObsidian(({ app }) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, TbxTermImportPlugin> } }).plugins.plugins['tbx-term-import']!;
		for (const modal of p.modals) modal.close();
	});
}

/** Drive the browser file input. Poll the resulting DOM state, with no fixed delay. */
async function loadFiles(files: { name: string; xml: string }[]): Promise<void> {
	await browser.executeObsidian((_context, inputs) => {
		const input = document.querySelector<HTMLInputElement>('[data-tbx="file"]')!;
		const transfer = new DataTransfer();
		for (const file of inputs) transfer.items.add(new File([file.xml], file.name, { type: 'application/xml' }));
		input.files = transfer.files;
		input.dispatchEvent(new Event('change', { bubbles: true }));
	}, files);
	await browser.waitUntil(async () => (await browser.$('[data-tbx="result"]').getText()) !== 'Reading local files.', { timeout: 10000 });
}

async function mockPro(active: boolean): Promise<void> {
	await browser.executeObsidian(async ({ app }, on) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, TbxTermImportPlugin> } }).plugins.plugins['tbx-term-import']!;
		const pro = p.pro!;
		if (!on) { pro.signOut(); return; }
		const opts = (pro as unknown as { opts: { http: () => Promise<unknown> } }).opts;
		opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
		app.secretStorage.setSecret('tbx-term-import-github-token', 'gho_' + '0'.repeat(36));
		await pro.refreshNow();
	}, active);
}

describe(`${pluginId} local import`, function () {
	afterEach(async () => { await closeModals(); await mockPro(false); });
	it('loads and reloads without errors', async function () {
		expect(await reloadPlugin(pluginId)).toEqual({ enabled: true, reloaded: true, errors: [] });
	});
	it('uses exact labels and shows alternate terms, definitions and missing targets', async function () {
		await browser.executeObsidianCommand(`${pluginId}:import-file`);
		await loadFiles([{ name: 'pump.tbx', xml }]);
		await expect(browser.$('[data-concept="c1"]')).toHaveText(expect.stringContaining('water pump'));
		await expect(browser.$('[data-concept="c3"]')).toHaveText(expect.stringContaining('Missing fr'));
		await browser.$('[data-tbx="target"]').selectByAttribute('value', 'de');
		await expect(browser.$('[data-concept="c1"]')).toHaveText(expect.stringContaining('Pumpe'));
		await expect(browser.$('[data-concept="c1"]')).not.toHaveText(expect.stringContaining('pompe'));
		await browser.$('[data-tbx="target"]').selectByAttribute('value', 'fr');
		await browser.$('[data-tbx="title"]').setValue('Glossary');
		await browser.executeObsidian(async ({ app }) => { if (!app.vault.getAbstractFileByPath('Glossary.md')) await app.vault.create('Glossary.md', 'Keep this note.'); });
		await browser.$('[data-tbx="create"]').click();
		await browser.waitUntil(async () => (await browser.$('[data-tbx="result"]').getText()).includes('Created Glossary-1.md.'), { timeout: 10000 });
		const output = await browser.executeObsidian(async ({ app }) => ({ old: await app.vault.cachedRead(app.vault.getFileByPath('Glossary.md')!), next: await app.vault.cachedRead(app.vault.getFileByPath('Glossary-1.md')!) }));
		expect(output.old).toBe('Keep this note.');
		expect(output.next).toContain('| Concept ID | en | fr |');
		expect(output.next).toContain('pump<br>water pump');
		expect(output.next).toContain('- c3&#58; missing fr.');
		expect(output.next).toContain('missing concept ID');
	});
	it('refuses broken XML, ENTITY, DTD and TBX v3 without a note', async function () {
		const before = await browser.executeObsidian(({ app }) => app.vault.getFiles().length);
		for (const bad of ['<martif><termEntry></martif>', '<!ENTITY x "a"><martif/>', '<!DOCTYPE martif><martif/>', '<tbx><conceptEntry id="x"/></tbx>']) {
			await browser.executeObsidianCommand(`${pluginId}:import-file`);
			await loadFiles([{ name: 'bad.tbx', xml: bad }]);
			await expect(browser.$('[data-tbx="create"]')).toBeDisabled();
			await expect(browser.$('[data-tbx="preview"]')).toHaveText(expect.stringMatching(/not valid|not supported|Unsupported dialect/));
			await closeModals();
		}
		expect(await browser.executeObsidian(({ app }) => app.vault.getFiles().length)).toBe(before);
	});
	it('reads a namespace prefix and ntig and makes dangerous text inert', async function () {
		const prefixed = '<t:martif xmlns:t="urn:test"><t:termEntry id="n1"><t:descrip type="definition">Line one\nLine two</t:descrip><t:langSet xml:lang="en"><t:ntig><t:termGrp><t:term>A|B &lt;img src=x&gt;</t:term></t:termGrp></t:ntig></t:langSet><t:langSet xml:lang="fr"><t:tig><t:term>texte</t:term></t:tig></t:langSet></t:termEntry></t:martif>';
		await browser.executeObsidianCommand(`${pluginId}:import-file`);
		await loadFiles([{ name: 'prefix.tbx', xml: prefixed }]);
		await expect(browser.$('[data-concept="n1"]')).toHaveText(expect.stringContaining('A|B <img src=x>'));
		expect(await browser.$$('[data-tbx="preview"] img').length).toBe(0);
		await browser.$('[data-tbx="title"]').setValue('Inert');
		await browser.$('[data-tbx="create"]').click();
		await browser.waitUntil(async () => (await browser.$('[data-tbx="result"]').getText()).includes('Created Inert.md.'), { timeout: 10000 });
		const output = await browser.executeObsidian(async ({ app }) => app.vault.cachedRead(app.vault.getFileByPath('Inert.md')!));
		expect(output).toContain('A&#124;B &#60;img');
		expect(output).toContain('Line one<br>Line two');
		expect(output).not.toContain('<img');
	});
	it('blocks batch and merge without a sponsorship', async function () {
		await mockPro(false);
		for (const command of ['import-batch', 'merge-file']) {
			await browser.executeObsidianCommand(`${pluginId}:${command}`);
			expect(await browser.$$('[data-tbx="file"]').length).toBe(0);
		}
	});
	it('imports two files with separate reports and excludes a rejected file', async function () {
		await mockPro(true);
		await browser.executeObsidianCommand(`${pluginId}:import-batch`);
		await loadFiles([{ name: 'one.tbx', xml }, { name: 'two.tbx', xml: later }, { name: 'rejected.tbx', xml: '<!DOCTYPE martif><martif/>' }]);
		await browser.$('[data-tbx="title"]').setValue('Batch');
		await browser.$('[data-tbx="create"]').click();
		await browser.waitUntil(async () => (await browser.$('[data-tbx="result"]').getText()).includes('Created Batch-1.md.'), { timeout: 10000 });
		const result = await browser.executeObsidian(async ({ app }) => ({ one: await app.vault.cachedRead(app.vault.getFileByPath('Batch.md')!), two: await app.vault.cachedRead(app.vault.getFileByPath('Batch-1.md')!), third: !!app.vault.getFileByPath('Batch-2.md') }));
		expect(result.one).toContain('Source file: one.tbx');
		expect(result.two).toContain('Source file: two.tbx');
		expect(result.third).toBe(false);
	});
	it('reviews changed concept IDs and creates a new merged note', async function () {
		await mockPro(true);
		await browser.executeObsidianCommand(`${pluginId}:merge-file`);
		await browser.executeObsidian(async ({ app }) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, TbxTermImportPlugin> } }).plugins.plugins['tbx-term-import']!;
			await [...p.modals][0]!.setPrevious(app.vault.getFileByPath('Glossary-1.md')!);
		});
		await loadFiles([{ name: 'later.tbx', xml: later }]);
		await expect(browser.$('[data-tbx="changes"]')).toHaveText(expect.stringContaining('changed'));
		await expect(browser.$('[data-tbx="changes"]')).toHaveText(expect.stringContaining('water pump'));
		await expect(browser.$('[data-tbx="changes"]')).toHaveText(expect.stringContaining('liquid pump'));
		await browser.$('[data-tbx="title"]').setValue('Reviewed');
		await browser.$('[data-tbx="create"]').click();
		await browser.waitUntil(async () => (await browser.$('[data-tbx="result"]').getText()).includes('Created Reviewed.md.'), { timeout: 10000 });
		const output = await browser.executeObsidian(async ({ app }) => ({ old: await app.vault.cachedRead(app.vault.getFileByPath('Glossary-1.md')!), next: await app.vault.cachedRead(app.vault.getFileByPath('Reviewed.md')!) }));
		expect(output.old).toContain('water pump');
		expect(output.old).not.toContain('liquid pump');
		expect(output.next).toContain('liquid pump');
		expect(output.next).toContain('- c1&#58; changed.');
	});
	it('disables a pending Pro import after sign out', async function () {
		await mockPro(true);
		await browser.executeObsidianCommand(`${pluginId}:import-batch`);
		await loadFiles([{ name: 'one.tbx', xml }]);
		await expect(browser.$('[data-tbx="create"]')).toBeEnabled();
		await mockPro(false);
		await expect(browser.$('[data-tbx="create"]')).toBeDisabled();
	});
});

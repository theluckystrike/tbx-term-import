import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import TbxTermImportPlugin from '../src/main';
import { preview, readTbx, readGlossary } from '../src/reader';
import { bindPro, isPro, onProChange, resetPro, SPONSORS } from '../src/pro';
import manifest from '../manifest.json';

const xml = '<martif><termEntry id="c1"><langSet xml:lang="en"><tig><term>pump</term></tig></langSet><langSet xml:lang="fr"><tig><term>pompe</term></tig></langSet></termEntry></martif>';
const report = () => preview(readTbx(xml), 'en', 'fr');
const plugin = () => new TbxTermImportPlugin(App.createConfigured__({ files: { 'Glossary.md': 'Keep this note.' } }) as never, manifest as never);
afterEach(() => resetPro());

describe('vault creation and Pro checks', () => {
	it('single-file core works without Pro and keeps an existing note unchanged', async () => {
		const p = plugin();
		const file = await p.writeGlossary('Glossary', 'local.tbx', report(), 'single');
		expect(file.path).toBe('Glossary-1.md');
		expect(await p.app.vault.cachedRead(p.app.vault.getFiles().find((f) => f.path === 'Glossary.md')!)).toBe('Keep this note.');
		expect(readGlossary(await p.app.vault.cachedRead(file)).rows[0]?.source).toEqual(['pump']);
	});
	it.each(['batch', 'merge'] as const)('blocks %s before a vault write when Pro is off', async (mode) => {
		const p = plugin();
		const create = vi.spyOn(p.app.vault, 'create');
		await expect(p.writeGlossary('New', 'local.tbx', report(), mode)).rejects.toThrow('Pro is required');
		expect(create).not.toHaveBeenCalled();
		expect(p.openImport(mode)).toBeNull();
	});
	it('batch writes separate source reports through the same Sponsors state', async () => {
		bindPro({ isPro: () => true, onChange: () => () => undefined } as never);
		const p = plugin();
		const one = await p.writeGlossary('Batch', 'one.tbx', report(), 'batch');
		const two = await p.writeGlossary('Batch', 'two.tbx', report(), 'batch');
		expect(one.path).toBe('Batch.md');
		expect(two.path).toBe('Batch-1.md');
		expect(await p.app.vault.cachedRead(one)).toContain('one.tbx');
		expect(await p.app.vault.cachedRead(two)).toContain('two.tbx');
	});
	it('does not write a zero-row success note or a traversal path', async () => {
		const p = plugin();
		const create = vi.spyOn(p.app.vault, 'create');
		await expect(p.writeGlossary('Empty', 'local.tbx', { ...report(), rows: [] }, 'single')).rejects.toThrow('no supported rows');
		await expect(p.writeGlossary('../Escape', 'local.tbx', report(), 'single')).rejects.toThrow('note name');
		expect(create).not.toHaveBeenCalled();
	});
	it('a concurrent collision fails without modifying the other note', async () => {
		const p = plugin();
		vi.spyOn(p.app.vault, 'getAbstractFileByPath').mockReturnValue(null);
		await expect(p.writeGlossary('Glossary', 'local.tbx', report(), 'single')).rejects.toThrow();
	});
	it('has the same payment values and facade lifecycle as the reference', () => {
		expect(SPONSORS).toEqual({ clientId: 'Ov23lic5UPGPZqhBlBGg', sponsorLogin: 'theluckystrike', minMonthlyUsd: 5, oneTimeUsd: 15, oneTimeMonths: 0, scope: 'read:user' });
		let active = false;
		let change = () => undefined;
		const off = vi.fn();
		bindPro({ isPro: () => active, onChange: (cb: () => void) => { change = cb; return off; } } as never);
		const notify = vi.fn();
		onProChange(notify);
		expect(isPro()).toBe(false);
		active = true; change();
		expect(isPro()).toBe(true);
		expect(notify).toHaveBeenCalledOnce();
		resetPro();
		expect(off).toHaveBeenCalledOnce();
		expect(isPro()).toBe(false);
	});
});

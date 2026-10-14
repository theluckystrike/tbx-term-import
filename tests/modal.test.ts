import { afterEach, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import TbxTermImportPlugin from '../src/main';
import { bindPro, resetPro } from '../src/pro';
import manifest from '../manifest.json';

const xml = '<martif><termEntry id="c1"><langSet xml:lang="en"><tig><term>pump</term></tig></langSet><langSet xml:lang="fr"><tig><term>pompe</term></tig></langSet></termEntry></martif>';
const plugins: TbxTermImportPlugin[] = [];
function open() {
	const p = new TbxTermImportPlugin(App.createConfigured__({ files: {} }) as never, manifest as never);
	plugins.push(p);
	return { p, modal: p.openImport('single')! };
}
afterEach(() => { for (const p of plugins) p.onunload(); plugins.length = 0; resetPro(); });

it('a refused file cannot create a note', async () => {
	const { p, modal } = open();
	const create = vi.spyOn(p.app.vault, 'create');
	await modal.loadFiles([new File(['<!DOCTYPE martif><martif/>'], 'bad.tbx')]);
	expect(modal.contentEl.querySelector('[data-tbx="preview"]')?.textContent).toContain('not supported');
	expect(modal.contentEl.querySelector<HTMLButtonElement>('[data-tbx="create"]')?.disabled).toBe(true);
	await modal.save();
	expect(create).not.toHaveBeenCalled();
});

it('closing a modal cancels a pending local read', async () => {
	const { p, modal } = open();
	let finish!: (buffer: ArrayBuffer) => void;
	const pending = new Promise<ArrayBuffer>((r) => { finish = r; });
	const file = { name: 'later.tbx', size: xml.length, arrayBuffer: () => pending, text: async () => xml } as File;
	const read = modal.loadFiles([file]);
	modal.close();
	finish(new TextEncoder().encode(xml).buffer as ArrayBuffer);
	await read;
	await modal.save();
	expect(p.app.vault.getFiles()).toHaveLength(0);
	expect(p.modals.size).toBe(0);
});

it('a failed title can be corrected and the plan can be retried', async () => {
	const { p, modal } = open();
	await modal.loadFiles([new File([xml], 'pump.tbx')]);
	const title = modal.contentEl.querySelector<HTMLInputElement>('[data-tbx="title"]')!;
	title.value = '../bad';
	await modal.save();
	expect(modal.contentEl.querySelector('[data-tbx="result"]')?.textContent).toContain('note name');
	expect(title.disabled).toBe(false);
	title.value = 'Good';
	await modal.save();
	expect(p.app.vault.getFiles().map((f) => f.path)).toEqual(['Good.md']);
});

it('a refused batch clears the earlier preview', async () => {
	bindPro({ isPro: () => true, onChange: () => () => undefined } as never);
	const p = new TbxTermImportPlugin(App.createConfigured__({ files: {} }) as never, manifest as never);
	plugins.push(p);
	const modal = p.openImport('batch')!;
	await modal.loadFiles([new File([xml], 'pump.tbx')]);
	expect(modal.contentEl.querySelector('[data-concept="c1"]')).not.toBeNull();
	await modal.loadFiles(Array.from({ length: 21 }, (_, i) => new File([xml], `f${i}.tbx`)));
	expect(modal.contentEl.querySelector('[data-tbx="result"]')?.textContent).toContain('up to 20');
	expect(modal.contentEl.querySelector('[data-concept="c1"]')).toBeNull();
});

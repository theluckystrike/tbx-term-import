import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runVector } from '../src/vectors';
import { MAX_BYTES, MAX_RECORDS, readTbx, preview, renderGlossary, readGlossary, readLocalFile } from '../src/reader';
import vectors from './fixtures/vectors.json';

describe('golden acceptance vectors', () => {
	for (const vector of vectors.cases) it(vector.name, () => expect(runVector(vector.args[0] as never)).toEqual(vector.expected));
	const shared = resolve(dirname(fileURLToPath(import.meta.url)), '../../../packages/spec/vectors/tbx-term-import.json');
	it.skipIf(!existsSync(shared))('the factory vectors match the exported fixtures', () => {
		expect(JSON.parse(readFileSync(shared, 'utf8'))).toEqual(vectors);
	});
});

describe('reader limits and inert output', () => {
	it('refuses the byte and record limits', () => {
		expect(() => readTbx(' '.repeat(MAX_BYTES + 1))).toThrow('4 MiB');
		expect(() => readTbx('<martif>' + '<termEntry/>'.repeat(MAX_RECORDS + 1) + '</martif>')).toThrow('10000');
	}, 120000);
	it('keeps dangerous text inert and round trips merge data', () => {
		const g = preview(readTbx('<martif><termEntry id="c1"><langSet xml:lang="en"><tig><term>&lt;img src=x onerror=alert(1)&gt;|```</term></tig></langSet><langSet xml:lang="fr"><tig><term>pompe</term></tig></langSet><descrip type="definition">a\nb</descrip></termEntry></martif>'), 'en', 'fr');
		const markdown = renderGlossary(g, '<source>.tbx', [], []);
		expect(markdown).toContain('a<br>b');
		expect(markdown).toContain('&#124;');
		expect(markdown).not.toContain('<img');
		expect(markdown.match(/^```/gm)).toHaveLength(2);
		expect(readGlossary(markdown)).toEqual(g);
	});
	it('encodes Obsidian comment and highlight marks so no row is hidden', () => {
		const g = preview(readTbx('<martif><termEntry id="c1"><langSet xml:lang="en"><tig><term>50%% off</term></tig></langSet><langSet xml:lang="fr"><tig><term>==pompe==</term></tig></langSet></termEntry><termEntry id="c2"><langSet xml:lang="en"><tig><term>valve</term></tig></langSet><langSet xml:lang="fr"><tig><term>vanne</term></tig></langSet></termEntry></martif>'), 'en', 'fr');
		const table = renderGlossary(g, 'local.tbx', [], []).split('## Merge data')[0];
		expect(table).not.toContain('%%');
		expect(table).not.toContain('==');
		expect(table).toContain('50&#37;&#37; off');
	});
	it('reads merge data from a note saved with CRLF line endings', () => {
		const g = preview(readTbx('<martif><termEntry id="c1"><langSet xml:lang="en"><tig><term>pump</term></tig></langSet><langSet xml:lang="fr"><tig><term>pompe</term></tig></langSet></termEntry></martif>'), 'en', 'fr');
		expect(readGlossary(renderGlossary(g, 'local.tbx', [], []).replace(/\n/g, '\r\n'))).toEqual(g);
	});
	it('refuses absent or corrupt merge metadata', () => {
		expect(() => readGlossary('# Other note')).toThrow('no TBX');
		expect(() => readGlossary('```tbx-term-import\n{"version":1,"source":"en","target":"fr","rows":[{}]}\n```\n')).toThrow('not valid');
	});
	it('checks raw UTF-8 before File.text and stops oversize files before reading', async () => {
		const bad = { size: 1, arrayBuffer: async () => new Uint8Array([255]).buffer, text: async () => 'bad' } as File;
		await expect(readLocalFile(bad)).rejects.toThrow('UTF-8');
		await expect(readLocalFile({ size: MAX_BYTES + 1 } as File)).rejects.toThrow('4 MiB');
		const good = new File(['<martif/>'], 'local.tbx');
		await expect(readLocalFile(good)).resolves.toBe('<martif/>');
	});
	it('rejects malformed attributes and an unbound namespace prefix', () => {
		expect(() => readTbx('<martif><termEntry id="x" id="y"/></martif>')).toThrow('XML is not valid');
		expect(() => readTbx('<martif><tb:termEntry/></martif>')).toThrow('XML is not valid');
	});
});

export const MAX_BYTES = 4 * 1024 * 1024;
export const MAX_RECORDS = 10000;

export interface Concept {
	id: string;
	languages: Record<string, { terms: string[]; definitions: string[] }>;
	definitions: string[];
}
export interface Parsed {
	languages: string[];
	concepts: Concept[];
	skipped: string[];
}
export interface Row {
	id: string;
	source: string[];
	target: string[];
	definitions: string[];
	missing: string[];
}
export interface Glossary {
	version: 1;
	source: string;
	target: string;
	rows: Row[];
}
export interface Preview extends Glossary {
	skipped: string[];
	warnings: string[];
}

function name(el: Element): string {
	return el.localName.split(':').pop() ?? '';
}
function children(el: Element, tag: string): Element[] {
	return Array.from(el.children).filter((e) => name(e) === tag);
}
function definitions(el: Element): string[] {
	return children(el, 'descrip').filter((e) => e.getAttribute('type') === 'definition').map((e) => e.textContent?.trim() ?? '').filter(Boolean);
}

/** Read the supported v2 record structures. XML stays outside the page DOM. */
export function readTbx(xml: string): Parsed {
	if (new TextEncoder().encode(xml).byteLength > MAX_BYTES) throw new Error('The file exceeds the 4 MiB limit.');
	if (/<!\s*(DOCTYPE|ENTITY)\b/i.test(xml)) throw new Error('DTD and ENTITY declarations are not supported.');
	const encoding = /<\?xml\b[^?]*encoding\s*=\s*["']([^"']+)["']/i.exec(xml)?.[1];
	if (encoding && !/^utf-?8$/i.test(encoding)) throw new Error('Use a UTF-8 XML file.');
	const doc = new DOMParser().parseFromString(xml, 'application/xml');
	const elements = Array.from(doc.getElementsByTagName('*'));
	if (!doc.documentElement || elements.some((e) => name(e) === 'parsererror')) throw new Error('The XML is not valid.');
	if (elements.some((e) => name(e) === 'conceptEntry')) throw new Error('Unsupported dialect: TBX v3 conceptEntry is not supported.');
	const entries = elements.filter((e) => name(e) === 'termEntry');
	if (!entries.length) throw new Error('Unsupported dialect: no supported termEntry records were found.');
	if (entries.length > MAX_RECORDS) throw new Error('The file exceeds the 10000 record limit.');
	const result: Parsed = { languages: [], concepts: [], skipped: [] };
	const ids = new Set<string>();
	entries.forEach((entry, index) => {
		const id = entry.getAttribute('id')?.trim() ?? '';
		if (!id || ids.has(id)) {
			result.skipped.push(`Record ${index + 1}: ${id ? 'duplicate concept ID ' + id : 'missing concept ID'}.`);
			return;
		}
		ids.add(id);
		const concept: Concept = { id, languages: Object.create(null) as Concept['languages'], definitions: definitions(entry) };
		for (const lang of children(entry, 'langSet')) {
			const label = lang.getAttribute('xml:lang') ?? '';
			if (!label) {
				result.skipped.push(`${id}: a langSet has no xml:lang label.`);
				continue;
			}
			if (!result.languages.includes(label)) result.languages.push(label);
			const data = concept.languages[label] ?? { terms: [], definitions: [] };
			data.definitions.push(...definitions(lang));
			for (const group of Array.from(lang.children)) {
				if (name(group) === 'tig') {
					data.terms.push(...children(group, 'term').map((e) => e.textContent?.trim() ?? '').filter(Boolean));
					data.definitions.push(...definitions(group));
				} else if (name(group) === 'ntig') {
					for (const termGroup of children(group, 'termGrp')) data.terms.push(...children(termGroup, 'term').map((e) => e.textContent?.trim() ?? '').filter(Boolean));
					data.definitions.push(...definitions(group));
				}
			}
			concept.languages[label] = data;
		}
		if (!Object.values(concept.languages).some((l) => l.terms.length)) result.skipped.push(`${id}: no supported nonempty terms.`);
		else result.concepts.push(concept);
	});
	return result;
}

export function preview(parsed: Parsed, source: string, target: string): Preview {
	if (source === target || !parsed.languages.includes(source) || !parsed.languages.includes(target)) throw new Error('Select two different exact xml:lang values from the file.');
	const result: Preview = { version: 1, source, target, rows: [], skipped: [...parsed.skipped], warnings: [] };
	for (const c of parsed.concepts) {
		const a = c.languages[source];
		const b = c.languages[target];
		if (!a?.terms.length && !b?.terms.length) {
			result.skipped.push(`${c.id}: no terms in the selected languages.`);
			continue;
		}
		const missing = [!a?.terms.length ? source : '', !b?.terms.length ? target : ''].filter(Boolean);
		for (const label of missing) result.warnings.push(`${c.id}: missing ${label}.`);
		result.rows.push({ id: c.id, source: [...(a?.terms ?? [])], target: [...(b?.terms ?? [])], definitions: [...c.definitions, ...(a?.definitions ?? []), ...(b?.definitions ?? [])], missing });
	}
	return result;
}

/** Numeric entities stop imported text from making Markdown links or HTML. */
export function cell(text: string): string {
	return text.replace(/[&<>"'\\|`*_[\]()!#^~:$%=]/g, (c) => `&#${c.charCodeAt(0)};`).replace(/\r\n?|\n/g, '<br>');
}

export function renderGlossary(g: Glossary, filename: string, skipped: string[], warnings: string[], changes: Change[] = []): string {
	const table = [`| Concept ID | ${cell(g.source)} | ${cell(g.target)} | Definitions | Status |`, '| --- | --- | --- | --- | --- |', ...g.rows.map((r) => `| ${cell(r.id)} | ${r.source.map(cell).join('<br>')} | ${r.target.map(cell).join('<br>')} | ${r.definitions.map(cell).join('<br>')} | ${r.missing.length ? 'Missing ' + r.missing.map(cell).join(', ') : 'Ready'} |`)];
	const lines = (items: string[]) => items.length ? items.map((s) => '- ' + cell(s)).join('\n') : 'None.';
	// Encode non-ASCII and punctuation in JSON as escapes. The fenced record cannot be closed by source text.
	const metadata = JSON.stringify(g).replace(/[<>&`\u007f-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
	return `# Glossary\n\nSource file: ${cell(filename)}\n\n${table.join('\n')}\n\n## Import report\n\nImported rows: ${g.rows.length}.\n\n### Skipped records\n\n${lines(skipped)}\n\n### Missing languages\n\n${lines(warnings)}\n\n${changes.length ? '### Merge changes\n\n' + lines(changes.map((c) => c.id + ': ' + c.kind + '.')) + '\n\n' : ''}## Merge data\n\nThis local record is used for later merges. Table edits do not change this record.\n\n\`\`\`tbx-term-import\n${metadata}\n\`\`\`\n`;
}

export interface Change { id: string; kind: 'added' | 'changed' | 'unchanged' | 'retained'; before: Row | null; after: Row }

export function mergeGlossary(old: Glossary, next: Glossary): { glossary: Glossary; changes: Change[] } {
	if (old.source !== next.source || old.target !== next.target) throw new Error('The merge requires the same source and target language labels.');
	const incoming = new Map(next.rows.map((r) => [r.id, r]));
	const known = new Set(old.rows.map((r) => r.id));
	const changes: Change[] = old.rows.map((before) => {
		const after = incoming.get(before.id);
		return { id: before.id, kind: !after ? 'retained' : JSON.stringify(before) === JSON.stringify(after) ? 'unchanged' : 'changed', before, after: after ?? before };
	});
	for (const after of next.rows) if (!known.has(after.id)) changes.push({ id: after.id, kind: 'added', before: null, after });
	return { glossary: { version: 1, source: next.source, target: next.target, rows: changes.map((c) => c.after) }, changes };
}

export function readGlossary(markdown: string): Glossary {
	if (new TextEncoder().encode(markdown).byteLength > 16 * MAX_BYTES) throw new Error('The glossary note is too large to merge.');
	const raw = /(?:^|\n)```tbx-term-import\n([^\n]+)\n```(?:\n|$)/.exec(markdown.replace(/\r\n?/g, '\n'))?.[1];
	if (!raw) throw new Error('This note has no TBX Term Import merge data.');
	const data: unknown = JSON.parse(raw);
	if (!data || typeof data !== 'object') throw new Error('The merge data is not valid.');
	const g = data as Partial<Glossary>;
	const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s: unknown) => typeof s === 'string');
	if (g.version !== 1 || typeof g.source !== 'string' || typeof g.target !== 'string' || g.source === g.target || !Array.isArray(g.rows) || g.rows.length > MAX_RECORDS) throw new Error('The merge data is not valid.');
	const ids = new Set<string>();
	for (const row of g.rows) {
		if (!row || typeof row.id !== 'string' || !row.id || ids.has(row.id) || !strings(row.source) || !strings(row.target) || !strings(row.definitions) || !strings(row.missing)) throw new Error('The merge data is not valid.');
		ids.add(row.id);
	}
	return g as Glossary;
}

export function freePath(title: string, exists: (path: string) => boolean): string {
	if (!title.trim() || /[\\/:*?"<>|#^[\]]/.test(title) || Array.from(title).some((c) => c.charCodeAt(0) < 32) || title === '.' || title === '..') throw new Error('Use a note name with no path or reserved characters.');
	const base = title.trim().replace(/\.md$/i, '');
	if (!base || base.endsWith('.') || base.startsWith('.')) throw new Error('Use a note name with no path or reserved characters.');
	for (let n = 0; n < 10000; n++) {
		const path = `${base}${n ? '-' + n : ''}.md`;
		if (!exists(path)) return path;
	}
	throw new Error('No unused note name was found.');
}

export async function readLocalFile(file: File): Promise<string> {
	if (file.size > MAX_BYTES) throw new Error('The file exceeds the 4 MiB limit.');
	try { new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); }
	catch { throw new Error('Use a UTF-8 XML file.'); }
	return file.text();
}

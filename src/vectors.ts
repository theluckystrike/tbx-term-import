import { readTbx, preview, freePath, cell, mergeGlossary, type Glossary } from './reader';

type VectorInput = { op: 'read'; xml: string; source: string; target: string } | { op: 'path'; title: string; existing: string[] } | { op: 'cell'; text: string } | { op: 'merge'; old: Glossary; next: Glossary };

/** The shared vector entry point. It also works in the standalone test tree. */
export function runVector(input: VectorInput): unknown {
	try {
		if (input.op === 'path') return freePath(input.title, (p) => input.existing.includes(p));
		if (input.op === 'cell') return cell(input.text);
		if (input.op === 'merge') return mergeGlossary(input.old, input.next);
		return preview(readTbx(input.xml), input.source, input.target);
	} catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
}

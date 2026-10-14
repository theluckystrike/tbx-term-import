import { JSDOM } from 'jsdom';
import { vi } from 'vitest';
vi.stubGlobal('DOMParser', new JSDOM('').window.DOMParser);

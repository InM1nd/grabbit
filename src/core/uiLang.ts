// Current UI language, kept free of React Native imports so db code stays testable in node.
import type { BoardLang } from './boards';
let current: BoardLang = 'ru';
export const setUiLang = (l: BoardLang) => { current = l; };
export const getUiLang = (): BoardLang => current;

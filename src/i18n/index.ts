// The language of the interface. English is the default; Portuguese and Spanish are one click away.
import { en, type Strings } from './en';
import { es } from './es';
import { pt } from './pt';

export type { Strings } from './en';
export type Lang = 'en' | 'pt' | 'es';

/** The languages on offer, in the order they are shown. */
export const LANGS: { code: Lang; short: string; name: string; tag: string }[] = [
  { code: 'en', short: 'EN', name: 'English', tag: 'en' },
  { code: 'pt', short: 'PT', name: 'Português', tag: 'pt-BR' },
  { code: 'es', short: 'ES', name: 'Español', tag: 'es' },
];
const ALL: Record<Lang, Strings> = { en, pt, es };
const KEY = 'lunar-window-lang';

type Tree = Record<string, unknown>;
/** Copies every sentence of `from` into `into`, keeping the objects of `into`: whoever holds one keeps a live one. */
function fill(into: Tree, from: Tree): void {
  for (const [key, value] of Object.entries(from)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (!into[key] || typeof into[key] !== 'object') into[key] = {};
      const kept = into[key] as Tree;
      // a table of names may have different entries in each language
      for (const old of Object.keys(kept)) if (!(old in (value as Tree))) delete kept[old];
      fill(kept, value as Tree);
    } else into[key] = value;
  }
}

/**
 * The sentences in use. It is one object for the life of the page: a change of language rewrites it in place, so
 * every module that took a part of it (`const T = S.plan`) keeps reading the right words.
 */
export const S = {} as Strings;
fill(S as unknown as Tree, en as unknown as Tree);

let current: Lang = 'en';
export const language = (): Lang => current;

/** The language asked for by the address (`?lang=pt`), else the one chosen last time, else English. */
export function initialLanguage(): Lang {
  const known = (code: string | null): code is Lang => code === 'en' || code === 'pt' || code === 'es';
  const asked = new URLSearchParams(location.search).get('lang');
  if (known(asked)) return asked;
  try {
    const kept = localStorage.getItem(KEY);
    if (known(kept)) return kept;
  } catch {
    /* no storage in private mode */
  }
  return 'en';
}

export function setLanguage(code: Lang, remember = true): void {
  current = code;
  fill(S as unknown as Tree, ALL[code] as unknown as Tree);
  document.documentElement.lang = LANGS.find((l) => l.code === code)!.tag;
  document.title = S.docTitle;
  if (remember)
    try {
      localStorage.setItem(KEY, code);
    } catch {
      /* not kept in private mode */
    }
}

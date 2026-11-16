import type { Lang } from '../i18n';

/** Flags of the three languages, drawn to one pattern: 21 by 15, simplified to what reads at that size. */
export const FLAGS: Record<Lang, string> = {
  en: '<svg viewBox="0 0 21 15" aria-hidden="true"><rect width="21" height="15" fill="#fff"/><g fill="#b22234"><rect width="21" height="2.15"/><rect y="4.29" width="21" height="2.14"/><rect y="8.57" width="21" height="2.14"/><rect y="12.86" width="21" height="2.14"/></g><rect width="9.4" height="8.57" fill="#3c3b6e"/><g fill="#fff"><circle cx="2.2" cy="2.2" r="0.62"/><circle cx="4.7" cy="2.2" r="0.62"/><circle cx="7.2" cy="2.2" r="0.62"/><circle cx="3.45" cy="4.3" r="0.62"/><circle cx="5.95" cy="4.3" r="0.62"/><circle cx="2.2" cy="6.4" r="0.62"/><circle cx="4.7" cy="6.4" r="0.62"/><circle cx="7.2" cy="6.4" r="0.62"/></g></svg>',
  pt: '<svg viewBox="0 0 21 15" aria-hidden="true"><rect width="21" height="15" fill="#009739"/><path d="M10.5 1.9 L19 7.5 L10.5 13.1 L2 7.5 Z" fill="#fedd00"/><circle cx="10.5" cy="7.5" r="3.35" fill="#012169"/><path d="M7.3 6.6 Q10.6 5.6 13.7 8.2" fill="none" stroke="#fff" stroke-width="0.7"/></svg>',
  es: '<svg viewBox="0 0 21 15" aria-hidden="true"><rect width="21" height="15" fill="#aa151b"/><rect y="3.75" width="21" height="7.5" fill="#f1bf00"/></svg>',
};

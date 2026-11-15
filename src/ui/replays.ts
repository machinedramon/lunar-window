import { S } from '../i18n';

// Real landings to replay: set the tool to the place and the minute of a landing and see what
// it says. Every statement in `happened` was checked against the source given with it.

export interface Replay {
  id: string;
  siteId: string;
  timeMs: number;
  label: string;
  year: string;
  when: string;
  happened: string;
  /** What to look for in the tool's answer. */
  look: string;
  source: { label: string; url: string };
}

const DATA: Omit<Replay, 'when' | 'happened' | 'look'>[] = [
  {
    id: 'apollo-11',
    siteId: 'apollo-11',
    timeMs: Date.UTC(1969, 6, 20, 20, 17),
    label: 'Apollo 11',
    year: '1969',
    source: { label: 'NASA NSSDCA', url: 'https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_sites.html' },
  },
  {
    id: 'chandrayaan-3',
    siteId: 'chandrayaan-3',
    timeMs: Date.UTC(2023, 7, 23, 12, 33),
    label: 'Chandrayaan-3',
    year: '2023',
    source: { label: 'Wikipedia, citing ISRO', url: 'https://en.wikipedia.org/wiki/Chandrayaan-3' },
  },
  {
    id: 'slim',
    siteId: 'slim',
    timeMs: Date.UTC(2024, 0, 19, 15, 20),
    label: 'SLIM',
    year: '2024',
    source: { label: 'JAXA', url: 'https://www.isas.jaxa.jp/en/topics/files/SLIM-press-briefing-20241226.pdf' },
  },
  {
    id: 'im-1',
    siteId: 'im1-odysseus',
    timeMs: Date.UTC(2024, 1, 22, 23, 23),
    label: 'IM-1 Odysseus',
    year: '2024',
    source: { label: 'Intuitive Machines', url: 'https://www.intuitivemachines.com/post/im-1-lunar-night-update-farewell-odysseus' },
  },
  {
    id: 'change-6',
    siteId: 'change-6',
    timeMs: Date.UTC(2024, 5, 1, 22, 23),
    label: "Chang'e 6",
    year: '2024',
    source: { label: "Wikipedia, Chang'e 6", url: 'https://en.wikipedia.org/wiki/Chang%27e_6' },
  },
  {
    id: 'blue-ghost',
    siteId: 'blue-ghost-1',
    timeMs: Date.UTC(2025, 2, 2, 8, 34),
    label: 'Blue Ghost M1',
    year: '2025',
    source: { label: 'NASA', url: 'https://www.nasa.gov/news-release/touchdown-carrying-nasa-science-fireflys-blue-ghost-lands-on-moon/' },
  },
  {
    id: 'im-2',
    siteId: 'im2-athena',
    timeMs: Date.UTC(2025, 2, 6, 17, 30),
    label: 'IM-2 Athena',
    year: '2025',
    source: { label: 'SpacePolicyOnline', url: 'https://spacepolicyonline.com/news/im-2-mission-ends-one-day-after-lunar-landing/' },
  },
];

/** The replays, with their sentences in the language in use. */
export const REPLAYS: Replay[] = DATA.map((r) => ({
  ...r,
  get when() {
    return S.replays[r.id].when;
  },
  get happened() {
    return S.replays[r.id].happened;
  },
  get look() {
    return S.replays[r.id].look;
  },
}));

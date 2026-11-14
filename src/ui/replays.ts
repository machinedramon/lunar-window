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

export const REPLAYS: Replay[] = [
  {
    id: 'apollo-11',
    siteId: 'apollo-11',
    timeMs: Date.UTC(1969, 6, 20, 20, 17),
    label: 'Apollo 11',
    year: '1969',
    when: '20 July 1969, 20:17 UTC',
    happened: 'Eagle landed in Mare Tranquillitatis at 20:17 UTC.',
    look: 'The Sun is low in the east: Apollo landings were timed for a low morning Sun, so that shadows would show the relief. The Earth is high in the sky, as it always is from the near side.',
    source: { label: 'NASA NSSDCA', url: 'https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_sites.html' },
  },
  {
    id: 'chandrayaan-3',
    siteId: 'chandrayaan-3',
    timeMs: Date.UTC(2023, 7, 23, 12, 33),
    label: 'Chandrayaan-3',
    year: '2023',
    when: '23 August 2023, 12:33 UTC',
    happened: 'Vikram landed at 12:33 UTC. The lander was put to sleep on 4 September, shortly before sunset, and did not wake after the lunar night.',
    look: 'The tool puts sunset at this site on 4 September 2023, the day the lander was put to sleep.',
    source: { label: 'Wikipedia, citing ISRO', url: 'https://en.wikipedia.org/wiki/Chandrayaan-3' },
  },
  {
    id: 'slim',
    siteId: 'slim',
    timeMs: Date.UTC(2024, 0, 19, 15, 20),
    label: 'SLIM',
    year: '2024',
    when: '19 January 2024, 15:20 UTC',
    happened: 'SLIM landed at 15:20 UTC, nose down.',
    look: 'The Sun is up and was still climbing in the east: it had risen about three days earlier and would set on 31 January.',
    source: { label: 'JAXA', url: 'https://www.isas.jaxa.jp/en/topics/files/SLIM-press-briefing-20241226.pdf' },
  },
  {
    id: 'im-1',
    siteId: 'im1-odysseus',
    timeMs: Date.UTC(2024, 1, 22, 23, 23),
    label: 'IM-1 Odysseus',
    year: '2024',
    when: '22 February 2024, 23:23 UTC',
    happened: 'Odysseus touched down at 23:23 UTC and tipped over. Contact ended on 29 February with the onset of lunar night.',
    look: 'Real terrain here. The tool puts sunset at this point on 2 March, for a panel 2 m above level ground; contact ended two days earlier. The lander lay tipped over on sloping ground, which an 80 m terrain model and an upright mast do not represent.',
    source: { label: 'Intuitive Machines', url: 'https://www.intuitivemachines.com/post/im-1-lunar-night-update-farewell-odysseus' },
  },
  {
    id: 'change-6',
    siteId: 'change-6',
    timeMs: Date.UTC(2024, 5, 1, 22, 23),
    label: "Chang'e 6",
    year: '2024',
    when: '1 June 2024, 22:23 UTC',
    happened: "Chang'e 6 landed at 22:23 UTC in the Apollo basin, on the far side of the Moon.",
    look: 'The Earth is never in the sky here: no direct link is possible at any date, which is why the mission talked to Earth through a relay satellite.',
    source: { label: "Wikipedia, Chang'e 6", url: 'https://en.wikipedia.org/wiki/Chang%27e_6' },
  },
  {
    id: 'blue-ghost',
    siteId: 'blue-ghost-1',
    timeMs: Date.UTC(2025, 2, 2, 8, 34),
    label: 'Blue Ghost M1',
    year: '2025',
    when: '2 March 2025, 08:34 UTC',
    happened: 'Blue Ghost landed at 08:34 UTC and worked for a full lunar day. It imaged the total eclipse of 14 March from the surface and the lunar sunset on 16 March; contact was lost about five hours after sunset.',
    look: 'The list of events below should show an eclipse beginning on 14 March and the sunset on 16 March.',
    source: { label: 'NASA', url: 'https://www.nasa.gov/news-release/touchdown-carrying-nasa-science-fireflys-blue-ghost-lands-on-moon/' },
  },
  {
    id: 'im-2',
    siteId: 'im2-athena',
    timeMs: Date.UTC(2025, 2, 6, 17, 30),
    label: 'IM-2 Athena',
    year: '2025',
    when: '6 March 2025, about 17:30 UTC',
    happened: 'Athena landed about 250 m from its target, inside a crater and on its side. Its batteries ran out about 12 hours later.',
    look: 'Real terrain here. At the published landing point, 2 m up, the tool finds full Sun and the Earth 12° above the skyline. A lander on its side at the bottom of a small crater sees far less sky than that: the limit of any model at 80 m.',
    source: { label: 'SpacePolicyOnline', url: 'https://spacepolicyonline.com/news/im-2-mission-ends-one-day-after-lunar-landing/' },
  },
];

// Map of the lunar south pole with the sites on it: shaded relief from the LOLA elevation
// model (tools/build_map.py), south polar stereographic, longitude 0 (the Earth-facing side) up.
import { COLORS, FONT, surface } from './canvas';

/** Half-width of the image in km, as built by tools/build_map.py. */
const IMAGE_HALF_KM = 310;
const MOON_RADIUS_KM = 1737.4;
/** Part of the map that is shown, in km from the pole: most sites lie on the Earth-facing side. */
const VIEW = { x0: -168, x1: 168, y0: -62, y1: 196 };

export interface MapSite {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** 0 not viable, 1 marginal, 2 viable; null while computing. */
  status: number | null;
  /** The visitor's own point: drawn with a dashed ring around it. */
  own?: boolean;
}

export interface MapInput {
  image: HTMLImageElement | null;
  sites: MapSite[];
  hover: string | null;
  selected: string | null;
  labels: { earth: string; pole: string; off: (name: string) => string };
}

export interface MapGeometry {
  points: { id: string; x: number; y: number }[];
  /** Pixels per kilometre. */
  kx: number;
}

/** Where a label goes relative to its marker, chosen by hand so that neighbours do not collide. */
const LABEL: Record<string, [number, number, CanvasTextAlign]> = {
  cr1: [-14, 16, 'right'],
  'shackleton-rim': [14, 18, 'left'],
  'de-gerlache-rim2': [-14, -5, 'right'],
  haworth: [-14, 4, 'right'],
  malapert: [-14, -8, 'right'],
  'mons-mouton': [-14, 12, 'right'],
  'nobile-rim1': [14, 14, 'left'],
  'im2-athena': [14, -6, 'left'],
};

export function projectKm(lat: number, lon: number): [number, number] {
  const r = 2 * MOON_RADIUS_KM * Math.tan(((90 + lat) * Math.PI) / 360);
  return [r * Math.sin((lon * Math.PI) / 180), r * Math.cos((lon * Math.PI) / 180)];
}

/** Latitude and longitude of a point of the drawn map. */
export function mapLatLon(g: MapGeometry, x: number, y: number): { lat: number; lon: number } {
  const kmx = x / g.kx + VIEW.x0;
  const kmy = VIEW.y1 - y / g.kx;
  return { lat: -90 + (2 * Math.atan(Math.hypot(kmx, kmy) / (2 * MOON_RADIUS_KM)) * 180) / Math.PI, lon: (Math.atan2(kmx, kmy) * 180) / Math.PI };
}

export function mapHit(g: MapGeometry, x: number, y: number): string | null {
  let best: string | null = null;
  let bestD = 16;
  for (const p of g.points) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestD) {
      bestD = d;
      best = p.id;
    }
  }
  return best;
}

export function drawPoleMap(canvas: HTMLCanvasElement, m: MapInput): MapGeometry {
  const width = canvas.clientWidth || canvas.parentElement?.clientWidth || 420;
  const height = Math.round((width * (VIEW.y1 - VIEW.y0)) / (VIEW.x1 - VIEW.x0));
  const { ctx, w, h } = surface(canvas, height);
  const kx = w / (VIEW.x1 - VIEW.x0);
  const X = (km: number) => (km - VIEW.x0) * kx;
  const Y = (km: number) => (VIEW.y1 - km) * kx;

  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, w, h);
  if (m.image && m.image.complete && m.image.naturalWidth) {
    const pxPerKm = m.image.naturalWidth / (2 * IMAGE_HALF_KM);
    ctx.filter = 'contrast(1.22) brightness(0.86)';
    ctx.drawImage(m.image, (VIEW.x0 + IMAGE_HALF_KM) * pxPerKm, (IMAGE_HALF_KM - VIEW.y1) * pxPerKm, (VIEW.x1 - VIEW.x0) * pxPerKm, (VIEW.y1 - VIEW.y0) * pxPerKm, 0, 0, w, h);
    ctx.filter = 'none';
  }

  // Graticule
  ctx.lineWidth = 1;
  ctx.font = `500 10.5px ${FONT}`;
  ctx.textBaseline = 'middle';
  for (const lat of [-88, -86, -84, -82]) {
    const r = projectKm(lat, 0)[1];
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath();
    ctx.arc(X(0), Y(0), r * kx, 0, Math.PI * 2);
    ctx.stroke();
    // Latitude labels where the circles cross the 90°W meridian: no site label lies there.
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.textAlign = 'left';
    if (X(-r) > 8) ctx.fillText(`${-lat}°S`, X(-r) + 4, Y(0) - 8);
  }
  for (let lon = 0; lon < 360; lon += 30) {
    const a = (lon * Math.PI) / 180;
    ctx.strokeStyle = 'rgba(255,255,255,0.13)';
    ctx.beginPath();
    ctx.moveTo(X(0), Y(0));
    ctx.lineTo(X(400 * Math.sin(a)), Y(400 * Math.cos(a)));
    ctx.stroke();
  }
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(X(0), Y(0), 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.textAlign = 'left';
  ctx.fillText(m.labels.pole, X(0) + 6, Y(0) + 9);
  ctx.textAlign = 'left';
  ctx.font = `600 10.5px ${FONT}`;
  ctx.fillStyle = COLORS.earth;
  ctx.fillText(`↑ ${m.labels.earth}`, 10, 13);

  // Sites
  const points: MapGeometry['points'] = [];
  const offMap: string[] = [];
  for (const s of m.sites) {
    const [kmx, kmy] = projectKm(s.lat, s.lon);
    if (kmx < VIEW.x0 || kmx > VIEW.x1 || kmy < VIEW.y0 || kmy > VIEW.y1) {
      offMap.push(s.id);
      continue;
    }
    points.push({ id: s.id, x: X(kmx), y: Y(kmy) });
  }
  // A small map is a minimap: markers only, and the name of the site under the pointer or selected.
  const compact = w < 380;
  const draw = (s: MapSite, x: number, y: number, edge: boolean) => {
    const active = s.id === m.hover || s.id === m.selected;
    const r = compact ? (active ? 7 : 5.5) : active ? 8 : 6.5;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r + 2.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    if (s.status === 2) {
      ctx.fillStyle = '#fff';
      ctx.fill();
    } else if (s.status === 1) {
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, r, Math.PI / 2, (3 * Math.PI) / 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
    } else {
      ctx.strokeStyle = s.status === null ? 'rgba(255,255,255,0.4)' : '#fff';
      ctx.stroke();
      if (s.status === 0) {
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(x - r * 0.45, y - r * 0.45);
        ctx.lineTo(x + r * 0.45, y + r * 0.45);
        ctx.moveTo(x + r * 0.45, y - r * 0.45);
        ctx.lineTo(x - r * 0.45, y + r * 0.45);
        ctx.stroke();
      }
    }
    if (s.id === m.selected) {
      ctx.strokeStyle = COLORS.earth;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, r + 5.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (s.own) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(x, y, r + 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (compact && !active && !s.own) return;
    const [dx, dy, align] = edge ? [12, 14, 'left' as CanvasTextAlign] : (LABEL[s.id] ?? [14, 4, 'left' as CanvasTextAlign]);
    const text = edge ? m.labels.off(s.name) : s.name;
    ctx.font = `${active ? 700 : 600} 11.5px ${FONT}`;
    // The name never leaves the frame.
    const tw = ctx.measureText(text).width;
    const left = Math.max(6, Math.min(w - tw - 6, align === 'right' ? x + dx - tw : align === 'center' ? x + dx - tw / 2 : x + dx));
    const ty = Math.max(12, Math.min(h - 10, y + dy));
    ctx.textAlign = 'left';
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.strokeText(text, left, ty);
    ctx.fillStyle = '#fff';
    ctx.fillText(text, left, ty);
  };
  // The site under the pointer and the selected one are drawn last, over their neighbours.
  const isActive = (s: MapSite) => s.id === m.hover || s.id === m.selected;
  for (const s of [...m.sites].sort((a, b) => Number(isActive(a)) - Number(isActive(b)))) {
    const p = points.find((q) => q.id === s.id);
    if (p) draw(s, p.x, p.y, false);
  }
  // Sites beyond the frame are pinned to its edge, in their direction from the pole.
  offMap.forEach((id, k) => {
    const s = m.sites.find((q) => q.id === id)!;
    const [kmx, kmy] = projectKm(s.lat, s.lon);
    const x = Math.max(16, Math.min(w - 16, X(kmx)));
    const y = Math.max(28 + k * 22, Math.min(h - 16, Y(kmy)));
    points.push({ id, x, y });
    draw(s, x, y, true);
  });
  return { points, kx };
}

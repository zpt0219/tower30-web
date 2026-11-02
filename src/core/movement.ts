import type {Effects} from "./effects";
import type { Unit } from "./model";
import { roundEven, STEP } from "./math";
export const distance = (
  a: { x: number; z: number },
  b: { x: number; z: number },
) => Math.sqrt((a.x-b.x)**2+(a.z-b.z)**2);
export const gap = (a: Unit, b: Unit) =>
  Math.max(0, distance(a, b) - a.radius - b.radius);
export const cellX = (i: number) => ((i % 31) - 15) * 0.8;
export const cellZ = (i: number) => (Math.floor(i / 31) - 7) * 0.8;
const cellIndex = (x: number, z: number) =>
  Math.max(0, Math.min(14, roundEven(z / 0.8 + 7))) * 31 +
  Math.max(0, Math.min(30, roundEven(x / 0.8 + 15)));
const footprint = (r: number, x: number, z: number) =>
  Math.abs(x) + r <= 12.4 + 0.0001 && Math.abs(z) + r <= 6 + 0.0001;
function segmentDistance(
  x: number,
  z: number,
  x1: number,
  z1: number,
  px: number,
  pz: number,
): number {
  const dx = x1 - x,
    dz = z1 - z,
    len = dx * dx + dz * dz,
    t =
      len < 1e-12
        ? 0
        : Math.max(0, Math.min(1, ((px - x) * dx + (pz - z) * dz) / len));
  return (px - x - dx * t) ** 2 + (pz - z - dz * t) ** 2;
}
export function canMove(
  u: Unit,
  x: number,
  z: number,
  units: Unit[],
  soft = true,
  ignore?: Unit,
): boolean {
  if (
    !footprint(u.radius, x, z) ||
    !footprint(u.radius, (x + u.x) * 0.5, (z + u.z) * 0.5)
  )
    return false;
  for (const v of units) {
    if (v === u || v === ignore || v.hp <= 0) continue;
    const r = (u.radius + v.radius) * (soft && u.enemy === v.enemy ? 0.94 : 1);
    if (segmentDistance(u.x, u.z, x, z, v.x, v.z) >= r * r - 1e-8) continue;
    const before = (u.x - v.x) ** 2 + (u.z - v.z) ** 2,
      after = (x - v.x) ** 2 + (z - v.z) ** 2;
    if (before < r * r && after > before + 1e-8) continue;
    return false;
  }
  return true;
}
export function separate(units: Unit[]): void {
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (let i = 0; i < units.length; i++)
      for (let j = i + 1; j < units.length; j++) {
        const a = units[i]!,
          b = units[j]!;
        if (a.hp <= 0 || b.hp <= 0) continue;
        let dx = a.x - b.x,
          dz = a.z - b.z,
          d = Math.sqrt(dx*dx+dz*dz);
        const required = a.radius + b.radius;
        if (d >= required - 0.0001) continue;
        if (d < 1e-6) {
          dx = a.enemy ? 1 : -1;
          dz = a.slot % 2 === 0 ? 0.5 : -0.5;
          d = Math.sqrt(dx*dx+dz*dz);
        }
        const nx = dx / d,
          nz = dz / d,
          push = Math.min(0.12, (required - distance(a, b)) * 0.5 + 0.0001);
        if (canMove(a, a.x + nx * push, a.z + nz * push, units, false, b)) {
          a.x += nx * push;
          a.z += nz * push;
          changed = true;
        }
        if (canMove(b, b.x - nx * push, b.z - nz * push, units, false, a)) {
          b.x -= nx * push;
          b.z -= nz * push;
          changed = true;
        }
      }
    if (!changed) break;
  }
}
export function deployment(
  u: Unit,
  units: Unit[],
  opening: boolean,
): { x: number; z: number } | null {
  const preferred = {
    x:
      (u.enemy ? 1 : -1) *
      (u.profile.Role === "tank"
        ? 8.8
        : u.profile.Role === "melee"
          ? 10.4
          : 11.8),
    z: ((u.slot % 3) - 1) * 2.4,
  };
  const side = Array.from({ length: 465 }, (_, i) => i).filter(
    (i) =>
      footprint(u.radius, cellX(i), cellZ(i)) &&
      (u.enemy ? cellX(i) > 0 : cellX(i) < 0),
  );
  const edge = u.enemy
    ? Math.max(...side.map(cellX))
    : Math.min(...side.map(cellX));
  const candidates = side.filter(
    (i) =>
      (opening || Math.abs(cellX(i) - edge) < 0.85) &&
      units.every(
        (v) =>
          v.hp <= 0 ||
          (v.x - cellX(i)) ** 2 + (v.z - cellZ(i)) ** 2 >=
            (v.radius + u.radius + 0.03) ** 2,
      ),
  );
  const cost = (i: number) =>
    (opening &&
    (Math.abs(cellX(i)) < 8.8 || ![4, 7, 10].includes(Math.floor(i / 31)))
      ? 1000
      : 0) +
    (cellX(i) - (opening ? preferred.x : edge)) ** 2 +
    (cellZ(i) - preferred.z) ** 2;
  candidates.sort((a, b) => cost(a) - cost(b));
  const i = candidates[0];
  return i === undefined ? null : { x: cellX(i), z: cellZ(i) };
}
const directions = [
  { x: -1, z: 0 },
  { x: 1, z: 0 },
  { x: 0, z: -1 },
  { x: 0, z: 1 },
];
export function move(u: Unit, target: Unit, units: Unit[], legacy = false, effects?:Pick<Effects,"HasteMoveMultiplier"|"SlowMoveMultiplier">,dt=STEP): void {
  const start = cellIndex(u.x, u.z),
    previous = new Array<number>(465).fill(-1),
    walk = Array.from({ length: 465 }, (_, i) =>
      footprint(u.radius, cellX(i), cellZ(i)),
    );
  previous[start] = start;
  for (const v of units) {
    if (v === u || v.hp <= 0) continue;
    const r = (u.radius + v.radius) * (u.enemy === v.enemy ? 0.9 : 1);
    const lowX = Math.max(0, Math.floor((v.x - r) / 0.8 + 15)),
      highX = Math.min(30, Math.ceil((v.x + r) / 0.8 + 15)),
      lowZ = Math.max(0, Math.floor((v.z - r) / 0.8 + 7)),
      highZ = Math.min(14, Math.ceil((v.z + r) / 0.8 + 7));
    for (let z = lowZ; z <= highZ; z++)
      for (let x = lowX; x <= highX; x++) {
        const i = z * 31 + x;
        if ((cellX(i) - v.x) ** 2 + (cellZ(i) - v.z) ** 2 < r * r)
          walk[i] = false;
      }
  }
  const queue = [start];
  let head = 0,
    goal = start,
    best = Infinity;
  const reach =
    u.radius +
    target.radius +
    (["ranged", "healer"].includes(u.profile.Role) ? 3.8 : 0.55);
  while (head < queue.length) {
    const at = queue[head++]!,
      d = Math.sqrt((cellX(at)-target.x)**2+(cellZ(at)-target.z)**2);
    if (d < best) {
      best = d;
      goal = at;
    }
    if (d <= reach + 0.08) {
      goal = at;
      break;
    }
    const phase = (u.slot + Math.trunc(u.blockedFor)) % 4;
    for (let n = 0; n < 4; n++) {
      const dir = directions[(n + phase) % 4]!,
        nx = (at % 31) + dir.x,
        nz = Math.floor(at / 31) + dir.z;
      if (nx < 0 || nx >= 31 || nz < 0 || nz >= 15) continue;
      const next = nz * 31 + nx;
      if (!walk[next] || previous[next]! >= 0) continue;
      previous[next] = at;
      queue.push(next);
    }
  }
  let step = goal;
  while (step !== start && previous[step] !== start) step = previous[step]!;
  const tx = step === start ? target.x : cellX(step),
    tz = step === start ? target.z : cellZ(step),
    dx = tx - u.x,
    dz = tz - u.z,
    length = Math.sqrt(dx*dx+dz*dz);
  if (length < 0.001) {
    u.blockedFor = Math.min(4, u.blockedFor + dt);
    return;
  }
  const travel = Math.min(length, dt * u.moveSpeed * (u.haste>0?(effects?.HasteMoveMultiplier??1.15):1) * (!legacy&&u.kind==="nightwing"&&u.leech>0?1.4:1) * (u.slow > 0 ? (effects?.SlowMoveMultiplier??.6) : 1)),
    direction = Math.atan2(dz, dx),
    side =
      (u.slot % 2 === 0 ? 1 : -1) *
      (Math.trunc(u.blockedFor) % 2 === 0 ? 1 : -1);
  for (const angle of [
    0,
    (side * Math.PI) / 6,
    (-side * Math.PI) / 6,
    (side * Math.PI) / 3,
    (-side * Math.PI) / 3,
    (side * Math.PI) / 2,
    (-side * Math.PI) / 2,
  ]) {
    const x = u.x + Math.cos(direction + angle) * travel,
      z = u.z + Math.sin(direction + angle) * travel;
    if (!canMove(u, x, z, units)) continue;
    u.x = x;
    u.z = z;
    u.blockedFor = 0;
    return;
  }
  u.blockedFor = Math.min(4, u.blockedFor + dt);
}

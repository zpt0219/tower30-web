import type { Snapshot } from "../core/engine";
import type { Event, Unit } from "../core/model";
import { config as visualConfig } from "../data/load";
const sizes = new Map(
  visualConfig.Species.map((s) => [s.Id, s.FrameSize as number]),
);
const images = new Map<string, HTMLImageElement>();
for (const id of [
  "hero",
  "princess",
  ...visualConfig.Species.map((s) => s.Id),
]) {
  const i = new Image();
  i.src = `${import.meta.env.BASE_URL}assets/${id}.png`;
  images.set(id, i);
}
export function sprite(
  ctx: CanvasRenderingContext2D,
  id: string,
  x: number,
  y: number,
  size: number,
  frame = 1,
  enemy = false,
) {
  const img = images.get(id);
  if (!img?.complete || !img.naturalWidth) return;
  const sy = id === "hero" || id === "princess" ? 16 : 0;
  const sh = sizes.get(id) ?? 16;
  const height = size;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  if (enemy) {
    ctx.translate(x, y);
    ctx.scale(-1, 1);
    ctx.drawImage(img, frame * sh, sy, sh, sh, -size / 2, -size, size, height);
  } else
    ctx.drawImage(
      img,
      frame * sh,
      sy,
      sh,
      sh,
      x - size / 2,
      y - size,
      size,
      height,
    );
  ctx.restore();
}
function tree(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  tint: string,
) {
  c.fillStyle = "#342c21";
  c.fillRect(x - 3 * s, y, 6 * s, 40 * s);
  c.fillStyle = tint;
  for (let i = 0; i < 3; i++) {
    c.beginPath();
    c.moveTo(x, y - 65 * s + i * 18 * s);
    c.lineTo(x - 24 * s + i * 3 * s, y - 10 * s + i * 16 * s);
    c.lineTo(x + 24 * s - i * 3 * s, y - 10 * s + i * 16 * s);
    c.closePath();
    c.fill();
  }
}
export function drawBattle(
  canvas: HTMLCanvasElement,
  s: Snapshot,
  previous: Snapshot | null,
  alpha: number,
  paused: boolean,
  names: (id: string) => string,
) {
  const rect = canvas.getBoundingClientRect(),
    dpr = Math.min(devicePixelRatio, 2),
    w = rect.width,
    h = rect.height;
  if (w < 1 || h < 1) return;
  if (
    canvas.width !== Math.round(w * dpr) ||
    canvas.height !== Math.round(h * dpr)
  ) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const c = canvas.getContext("2d")!;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const sky = c.createLinearGradient(0, 0, 0, h);
  const palette =
    s.arenaBackground === "coast"
      ? ["#668c99", "#a7bdba", "#a59c72", "#6a7b63"]
      : s.arenaBackground === "dragon"
        ? ["#5d5059", "#9d7870", "#76634e", "#51453d"]
        : s.arenaBackground === "castle"
          ? ["#555f6c", "#8e939a", "#757b70", "#424b42"]
          : ["#45675d", "#80978a", "#727d53", "#414d38"];
  sky.addColorStop(0, palette[0]!);
  sky.addColorStop(0.48, palette[1]!);
  sky.addColorStop(0.49, palette[2]!);
  sky.addColorStop(1, palette[3]!);
  c.fillStyle = sky;
  c.fillRect(0, 0, w, h);
  c.fillStyle = "#a3ae8c35";
  c.beginPath();
  c.moveTo(w * 0.4, h * 0.15);
  c.lineTo(w * 0.8, h * 0.8);
  c.lineTo(w * 0.56, h * 0.8);
  c.fill();
  for (let i = 0; i < 20; i++)
    tree(
      c,
      (i * w) / 19,
      h * 0.33 + (i % 3) * 9,
      0.75 + (i % 4) * 0.18,
      i % 2 ? "#35594b" : "#2b4a40",
    );
  const px = (x: number) => ((x + 12.5) / 25) * w,
    pz = (z: number) => h * 0.53 + (z / 12) * h * 0.57;
  c.fillStyle = "#bcb18333";
  c.beginPath();
  c.ellipse(w * 0.5, h * 0.64, w * 0.45, h * 0.3, 0, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = "#d3c9a413";
  c.lineWidth = 1;
  for (let z = -5; z <= 5; z += 2) {
    c.beginPath();
    c.moveTo(0, pz(z));
    c.lineTo(w, pz(z));
    c.stroke();
  }
  for (let x = -12; x <= 12; x += 2) {
    c.beginPath();
    c.moveTo(px(x), pz(-5));
    c.lineTo(px(x), pz(5));
    c.stroke();
  }
  for (let i = 0; i < 70; i++) {
    const x = (i * 127 + 63) % Math.round(w),
      y = h * 0.45 + ((i * 73) % Math.max(1, Math.round(h * 0.52)));
    c.fillStyle = i % 5 === 0 ? "#c2ae7244" : "#a2ac7240";
    c.fillRect(x, y, 2 + (i % 3), 2);
  }
  const b = s.battle;
  if (!b) return;
  for (const zone of b.zones) {
    c.fillStyle = "#eaa14442";
    c.strokeStyle = "#f8d18c99";
    c.beginPath();
    c.ellipse(px(zone.x), pz(zone.z), Math.abs(px(zone.x+zone.radius)-px(zone.x)), Math.abs(pz(zone.z+zone.radius)-pz(zone.z)), 0, 0, Math.PI*2);
    c.fill(); c.stroke();
  }
  const interp = (u: Unit) => {
    const prev = previous?.battle?.units.find((v) => v.id === u.id);
    return {
      x: prev ? prev.x + (u.x - prev.x) * alpha : u.x,
      z: prev ? prev.z + (u.z - prev.z) * alpha : u.z,
    };
  };
  const units = [...b.units].sort((a, b) => a.z - b.z);
  const unitSize = Math.max(26, Math.min(48, h * 0.14));
  for (const u of units) {
    const pos = interp(u),
      x = px(pos.x),
      y = pz(pos.z),
      size = unitSize;
    c.save();
    c.globalAlpha = u.hp <= 0 ? 0.22 : u.entry > 0 ? 0.55 : 1;
    c.fillStyle = "#17261b70";
    c.beginPath();
    c.ellipse(x, y + size * 0.08, size * 0.65, size * 0.2, 0, 0, Math.PI * 2);
    c.fill();
    if (u.action?.kind === "ultimate") {
      c.strokeStyle = "#ffe1a4";
      c.lineWidth = 3;
      c.beginPath();
      c.ellipse(
        x,
        y + size * 0.08,
        size * 0.85,
        size * 0.28,
        0,
        0,
        Math.PI * 2,
      );
      c.stroke();
    }
    sprite(
      c,
      u.kind,
      x,
      y,
      size,
      b.tick % 12 < 4 ? 0 : b.tick % 12 < 8 ? 1 : 2,
      u.enemy,
    );
    if (u.hp > 0 && u.barrier > 0) {
      c.strokeStyle = "#c6f4e7"; c.lineWidth = 2;
      c.beginPath(); c.ellipse(x,y-size*.5,size*.65,size*.9,0,0,Math.PI*2); c.stroke();
    }
    c.globalAlpha = 1;
    if (u.hp > 0) {
      const barW = Math.max(54, size * 1.8),
        barY = y - size * 1.5;
      c.fillStyle = "#1d2d24";
      c.fillRect(x - barW / 2, barY, barW, 7);
      c.fillStyle = u.enemy ? "#d68a70" : "#9dc795";
      c.fillRect(
        x - barW / 2 + 1,
        barY + 1,
        ((barW - 2) * u.hp) / u.attributes.MaxHp,
        5,
      );
      c.fillStyle = "#1d2d24";
      c.fillRect(x - barW / 2, barY + 9, barW, 4);
      c.fillStyle = "#e6c174";
      c.fillRect(
        x - barW / 2 + 1,
        barY + 10,
        ((barW - 2) * u.energy) / 1000,
        2,
      );
      c.font = "bold 13px sans-serif";
      c.textAlign = "center";
      c.fillStyle = "#fff2d4";
      c.shadowColor = "#10291c";
      c.shadowBlur = 4;
      c.fillText(names(u.kind), x, y + size * 0.45);
      if (u.slow > 0 || u.stun > 0 || u.taunt > 0 || u.shield > 0 || u.armorBreak > 0 || u.root > 0 || u.weaken > 0 || u.silence > 0 || u.physicalGuard > 0 || u.spellGuard > 0) {
        c.fillStyle = "#b4e7ed";
        c.fillText([u.stun>0?"眩晕":"",u.silence>0?"沉默":"",u.root>0?"扎根":"",u.weaken>0?"弱化":"",u.physicalGuard>0?"物防":"",u.spellGuard>0?"法防":"",u.taunt>0?"受嘲讽":"",u.shield>0?"减伤":"",u.armorBreak>0?"破甲":"",u.slow>0?"减速":""].filter(Boolean).slice(0,2).join(" · "), x, y + size * 0.45 + 17);
      }
      if (u.action) {
        c.fillStyle = "#f9de9c";
        c.fillText(
          u.action.kind === "ultimate"
            ? "大招吟唱"
            : u.action.kind === "auto"
              ? "自动技能"
              : "普攻前摇",
          x,
          barY - 7,
        );
      }
    }
    c.restore();
  }
  for (const p of b.projectiles) {
    c.fillStyle = p.rule.Family === "water" ? "#9de1e3" : "#f4e2a8";
    c.shadowColor = c.fillStyle;
    c.shadowBlur = 10;
    c.beginPath();
    c.arc(px(p.x), pz(p.z) - unitSize * 0.4, 4, 0, Math.PI * 2);
    c.fill();
    c.shadowBlur = 0;
  }
  for (const e of s.events.filter(
    (e) => ["hit", "heal", "dodge"].includes(e.kind) && s.tick - e.tick < 16,
  )) {
    const target = b.units.find((u) => u.id === e.target);
    if (!target) continue;
    floating(
      c,
      e,
      px(target.x),
      pz(target.z) - unitSize * 1.4 - (s.tick - e.tick) * 2,
      s.tick,
    );
  }
  c.font = "13px sans-serif";
  c.fillStyle = "#edf0c6b0";
  c.textAlign = "left";
  c.fillText(
    s.arenaBackground === "coast"
      ? "海岸战场"
      : s.arenaBackground === "dragon"
        ? "龙境战场"
        : s.arenaBackground === "castle"
          ? "城堡战场"
          : "林地战场",
    16,
    h - 16,
  );
  if (paused && !b.result) {
    c.fillStyle = "#152c2390";
    c.fillRect(0, 0, w, h);
    c.textAlign = "center";
    c.fillStyle = "#f8eacc";
    c.font = "bold 28px serif";
    c.fillText("战斗已暂停", w / 2, h / 2);
    c.font = "16px sans-serif";
    c.fillText("继续后从当前时刻推进", w / 2, h / 2 + 30);
  }
}
function floating(
  c: CanvasRenderingContext2D,
  e: Event,
  x: number,
  y: number,
  tick: number,
) {
  c.save();
  c.globalAlpha = 1 - (tick - e.tick) / 16;
  c.textAlign = "center";
  c.font = `bold ${e.critical ? 24 : 20}px sans-serif`;
  c.lineWidth = 3;
  c.strokeStyle = "#1c3028";
  const text =
    e.kind === "dodge"
      ? "闪避"
      : `${e.amount > 0 ? "+" : ""}${e.amount}${e.critical ? "!" : ""}`;
  c.strokeText(text, x, y);
  c.fillStyle = e.amount > 0 ? "#c5eda2" : e.critical ? "#ffe3a0" : "#fff6e2";
  c.fillText(text, x, y);
  c.restore();
}

import { clone } from "../core/math";
import type { Config } from "../core/config";
import { readPath, setPath, type EditorProject } from "./project";

/** Monster sheets are 3 walk frames × 4 facing rows of square frames. */
export const SHEET_COLUMNS = 3;
export const SHEET_ROWS = 4;
export const FRAME_SIZES = [16, 32, 64] as const;
export type FrameSize = (typeof FRAME_SIZES)[number];
export const MAX_SPRITE_DATA_URL = 300_000;

export function sheetFrameSize(
  width: number,
  height: number,
): { frameSize: FrameSize } | { error: string } {
  const expected = FRAME_SIZES.map(
    (f) => `${f * SHEET_COLUMNS}×${f * SHEET_ROWS}`,
  ).join(" / ");
  const frame = width / SHEET_COLUMNS;
  if (
    FRAME_SIZES.includes(frame as FrameSize) &&
    height === frame * SHEET_ROWS
  )
    return { frameSize: frame as FrameSize };
  return {
    error: `图片为 ${width}×${height}，需要 3列×4行 的正方形帧：${expected} 像素`,
  };
}

export interface NewMonsterInput {
  name: string;
  templateId: string;
  spriteDataUrl: string;
  frameSize: FrameSize;
  layout?: "sheet" | "single";
}

function speciesList(project: EditorProject): Record<string, unknown>[] {
  const list = readPath(project.source, ["Species"]);
  if (!Array.isArray(list)) throw new Error("配表缺少物种列表");
  return list as Record<string, unknown>[];
}

export function nextMonsterId(project: EditorProject): string {
  const used = new Set<string>([
    "hero",
    "princess",
    ...speciesList(project).map((s) => String(s.Id)),
    ...Object.keys(
      (readPath(project.source, ["Rules", "Combatants"]) as object) ?? {},
    ),
  ]);
  for (let i = 1; ; i++) {
    const id = `custom_${String(i).padStart(2, "0")}`;
    if (!used.has(id)) return id;
  }
}

/**
 * Adds a monster that copies all numbers, skills and tier from an existing template,
 * with its own name and uploaded sheet. Returns the new species ID.
 */
export function createMonster(
  project: EditorProject,
  fallback: Config,
  input: NewMonsterInput,
): string {
  const name = input.name.trim();
  if (!name) throw new Error("请填写怪兽名称");
  if (name.length > 40) throw new Error("怪兽名称不能超过40字");
  if (!FRAME_SIZES.includes(input.frameSize)) throw new Error("贴图帧尺寸无效");
  if (
    !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(input.spriteDataUrl) ||
    input.spriteDataUrl.length > MAX_SPRITE_DATA_URL
  )
    throw new Error("贴图需为不超过约220KB的PNG");
  const list = speciesList(project);
  if (list.length >= 200) throw new Error("角色库最多支持200种怪兽");
  const template =
    list.find((s) => s.Id === input.templateId) ??
    fallback.Species.find((s) => s.Id === input.templateId);
  if (!template || ["hero", "princess"].includes(input.templateId))
    throw new Error("请选择一个已有怪兽作为模版");
  const section = (key: "Species" | "Combatants" | "Profiles") => {
    const value =
      readPath(project.source, ["Rules", key, input.templateId]) ??
      fallback.Rules[key][input.templateId];
    if (value === undefined) throw new Error(`模版缺少${key}数据`);
    return clone(value);
  };
  const rules = section("Species"),
    combatant = section("Combatants"),
    profile = section("Profiles");
  if (input.templateId === "nightwing")
    (profile as Config["Rules"]["Profiles"][string]).LeechMoveMultiplier ??= 1.4;
  const id = nextMonsterId(project);
  list.push({
    ...clone(template),
    Id: id,
    Name: name,
    Sprite: id,
    FrameSize: input.frameSize,
    ...(input.layout === "single" ? { SpriteLayout: "single" } : { SpriteLayout: "sheet" }),
  });
  setPath(project.source, ["Rules", "Species", id], rules);
  setPath(project.source, ["Rules", "Combatants", id], combatant);
  setPath(project.source, ["Rules", "Profiles", id], profile);
  project.sprites = { ...(project.sprites ?? {}), [id]: input.spriteDataUrl };
  return id;
}

/** Removes the uploaded sheet of a deleted monster. */
export function dropSprite(project: EditorProject, id: string) {
  if (!project.sprites?.[id]) return;
  if (speciesList(project).some(s => s.Id === id || s.Sprite === id)) return;
  const { [id]: _removed, ...rest } = project.sprites;
  project.sprites = Object.keys(rest).length ? rest : undefined;
}

/** Moves the uploaded sheet when a monster ID is renamed. */
export function renameSprite(
  project: EditorProject,
  oldId: string,
  newId: string,
) {
  const data = project.sprites?.[oldId];
  if (!data) return;
  for (const entry of speciesList(project))
    if (entry.Sprite === oldId) entry.Sprite = newId;
  const { [oldId]: _removed, ...rest } = project.sprites!;
  project.sprites = { ...rest, [newId]: data };
}

export function dataUrlBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

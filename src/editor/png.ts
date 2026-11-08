import type { EditorProject } from "./project";
import { dataUrlBytes, MAX_SPRITE_DATA_URL, sheetFrameSize, type FrameSize } from "./roster";

export interface MonsterPng {
  url: string;
  width: number;
  height: number;
  sheetSize?: FrameSize;
}
export const MAX_PNG_BYTES = Math.floor((MAX_SPRITE_DATA_URL - 22) / 4) * 3;

async function inspectPng(url: string): Promise<MonsterPng> {
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(url) || url.length > MAX_SPRITE_DATA_URL)
    throw new Error("请选择不超过220KB的PNG图片");
  const bytes = dataUrlBytes(url);
  if (bytes.length < 33 || ![137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v) ||
      String.fromCharCode(...bytes.slice(12,16)) !== "IHDR")
    throw new Error("文件不是有效PNG，请重新选择图片");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16), height = view.getUint32(20);
  if (!width || !height || width > 2048 || height > 2048)
    throw new Error("PNG宽高需在1—2048像素之间");
  const img = new Image();
  img.src = url;
  try { await img.decode(); } catch { throw new Error("PNG内容损坏，无法读取图片"); }
  const sheet = sheetFrameSize(width,height);
  return { url, width, height, ...("frameSize" in sheet ? { sheetSize: sheet.frameSize } : {}) };
}

export async function readMonsterPng(file: File): Promise<MonsterPng> {
  if (file.size > MAX_PNG_BYTES) throw new Error("PNG不能超过220KB，请先缩小或压缩图片");
  const url = await new Promise<string>((resolve,reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("图片读取失败，请重新选择"));
    reader.readAsDataURL(new Blob([file],{ type:"image/png" }));
  });
  return inspectPng(url);
}

export async function validateProjectSprites(project: EditorProject) {
  const species = (project.source as { Species: {Id:string;Sprite:string;FrameSize:number;SpriteLayout?:string}[] }).Species;
  for (const [id,url] of Object.entries(project.sprites ?? {})) {
    const image = await inspectPng(url);
    for (const s of species.filter(s => s.Sprite === id)) {
      if (s.SpriteLayout !== "single" && image.sheetSize !== s.FrameSize)
        throw new Error(`${s.Id} 的PNG与行走图切片规格不一致`);
    }
  }
}

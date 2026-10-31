import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
export function artifactDirectory(): string {
  if (process.env.TOWER_ARTIFACT_DIR) {
    mkdirSync(process.env.TOWER_ARTIFACT_DIR, { recursive: true });
    return process.env.TOWER_ARTIFACT_DIR;
  }
  if (existsSync(".artifact-dir"))
    return readFileSync(".artifact-dir", "utf8").trim();
  const d = new Date(),
    pad = (n: number) => String(n).padStart(2, "0"),
    stamp = `${pad(d.getFullYear() % 100)}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  const dir = `/srv/nas/Shared/hd2d-videos/${stamp}_tower30_web_checks`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(".artifact-dir", dir + "\n");
  return dir;
}

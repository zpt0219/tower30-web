import { describe, it, expect } from "vitest";
import { buildZip, readZip } from "../../src/editor/zip";

describe("ZIP 生成与读取", () => {
  it("可打包多文件、包含中文文件名与文本/二进制内容，并精确还原", () => {
    const decoder = new TextDecoder();
    const binaryData = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3]);

    const zipBytes = buildZip([
      { name: "config/thirty-floor-trial-draft.json", data: '{"version":1}' },
      { name: "MONSTER_ROSTER.md", data: "# 怪兽图鉴\n- 蘑菇精\n- 史莱姆" },
      { name: "sprites/slime.png", data: binaryData },
    ]);

    expect(zipBytes.length).toBeGreaterThan(100);

    const files = readZip(zipBytes);
    expect(files.size).toBe(3);
    expect(decoder.decode(files.get("config/thirty-floor-trial-draft.json"))).toBe('{"version":1}');
    expect(decoder.decode(files.get("MONSTER_ROSTER.md"))).toContain("蘑菇精");
    expect(files.get("sprites/slime.png")).toEqual(binaryData);
  });
  it("拒绝损坏内容、截断、重复文件及路径穿越", () => {
    const zip = buildZip([{ name: "project.json", data: "original" }]);
    const corrupt = zip.slice();
    corrupt[30 + "project.json".length] = corrupt[30 + "project.json".length]! ^ 1;
    expect(() => readZip(corrupt)).toThrow("校验失败");
    expect(() => readZip(zip.slice(0, -1))).toThrow();
    expect(() => readZip(buildZip([{ name: "../project.json", data: "x" }]))).toThrow("文件名");
    expect(() => readZip(buildZip([{ name: "same", data: "1" }, { name: "same", data: "2" }]))).toThrow("重复文件");
  });
});

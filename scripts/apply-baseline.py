#!/usr/bin/env python3
"""Apply an exported tower30 ZIP or JSON project as the repository's default baseline."""
from pathlib import Path
import base64, json, os, shutil, subprocess, sys, zipfile

root = Path(__file__).resolve().parents[1]
target_json = root / "data" / "tower" / "thirty-floor-trial.json"
assets_dir = root / "public" / "assets"

if len(sys.argv) < 2:
    print("用法: python3 scripts/apply-baseline.py <tower30-project.zip 或 .json 文件路径>")
    sys.exit(1)

source_path = Path(sys.argv[1]).expanduser().resolve()
if not source_path.is_file():
    print(f"错误: 找不到文件: {source_path}")
    sys.exit(1)

# Ensure backup of current baseline
backup_json = target_json.with_name(f"{target_json.stem}.backup.json")
shutil.copyfile(target_json, backup_json)

applied_config = False
applied_sprites = 0

try:
    if source_path.suffix.lower() == ".zip":
        with zipfile.ZipFile(source_path, "r") as zf:
            names = zf.namelist()
            # 1. Look for thirty-floor-trial-draft.json or tower30-editor-project.json
            if "thirty-floor-trial-draft.json" in names:
                raw = zf.read("thirty-floor-trial-draft.json").decode("utf-8")
                parsed = json.loads(raw)
                target_json.write_text(json.dumps(parsed, ensure_ascii=False, indent=2) + "\n")
                applied_config = True
            elif "tower30-editor-project.json" in names:
                raw = zf.read("tower30-editor-project.json").decode("utf-8")
                parsed = json.loads(raw)
                source_conf = parsed.get("source", parsed)
                target_json.write_text(json.dumps(source_conf, ensure_ascii=False, indent=2) + "\n")
                applied_config = True

            # 2. Extract sprites/*.png
            for item in names:
                if item.startswith("sprites/") and item.lower().endswith(".png"):
                    sprite_name = Path(item).name
                    dest = assets_dir / sprite_name
                    with zf.open(item) as src, open(dest, "wb") as dst:
                        shutil.copyfileobj(src, dst)
                    applied_sprites += 1
    elif source_path.suffix.lower() == ".json":
        data = json.loads(source_path.read_text(encoding="utf-8"))
        if isinstance(data, dict) and data.get("format") == "tower30-editor-project":
            source_conf = data.get("source")
            if not source_conf:
                raise ValueError("项目 JSON 缺少 source 配表配置")
            target_json.write_text(json.dumps(source_conf, ensure_ascii=False, indent=2) + "\n")
            applied_config = True
            # Check for base64 sprites
            sprites = data.get("sprites") or {}
            for name, b64uri in sprites.items():
                if "," in b64uri:
                    b64data = b64uri.split(",", 1)[1]
                else:
                    b64data = b64uri
                png_bytes = base64.b64decode(b64data)
                dest = assets_dir / f"{name}.png"
                dest.write_bytes(png_bytes)
                applied_sprites += 1
        elif isinstance(data, dict) and "Rules" in data and "Species" in data:
            target_json.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
            applied_config = True
        else:
            raise ValueError("无法识别的 JSON 格式（既不是 tower30-editor-project 也不是标准塔配表）")
    else:
        raise ValueError(f"不支持的文件格式: {source_path.suffix}，请提供 .zip 或 .json 文件")

    if not applied_config:
        raise ValueError("未从输入文件中找到有效的配表数据")

    # Run strict typecheck to ensure validity
    print("正在进行 TypeScript 严格检查与配表校验...")
    subprocess.run(["npm", "run", "typecheck"], cwd=root, check=True)

    print("✔ 配表与素材已成功应用为工程默认设定！")
    print(f"  - 配表已更新: {target_json}")
    if applied_sprites > 0:
        print(f"  - 已提取并更新 {applied_sprites} 张贴图素材至 {assets_dir}")
    print("\n如需同步部署到本地服务器主页卡片，请执行:")
    print("  npm run deploy:lan")

except Exception as e:
    # Rollback on failure
    if backup_json.exists():
        shutil.copyfile(backup_json, target_json)
    print(f"❌ 应用失败并已回滚: {e}", file=sys.stderr)
    sys.exit(1)
finally:
    if backup_json.exists():
        backup_json.unlink()

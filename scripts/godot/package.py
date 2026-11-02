"""Package the independent, editor-runnable Godot project; no sibling project reads."""
from pathlib import Path
import hashlib,json,os,zipfile
root=Path(__file__).resolve().parents[2]
os.chdir(root)
art=Path(os.environ.get('TOWER_ARTIFACT_DIR') or Path('.artifact-dir').read_text().strip())
version=json.loads(Path('package.json').read_text())['version']
out=art/f'tower30-godot-v{version}-project.zip'
project=Path('integrations/godot')
run='''#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
engine="${GODOT:-godot-mono}"
dotnet build Tower30Proof.csproj -c Debug
"$engine" --headless --editor --path . --import
exec "$engine" --path . "$@"
'''
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for p in sorted(project.rglob('*')):
  r=p.relative_to(project)
  if not p.is_file() or any(part in ['.godot','bin','obj','assets'] for part in r.parts) or p.suffix=='.import':continue
  z.write(p,'Tower30Godot/'+r.as_posix())
 z.writestr('Tower30Godot/RUN.sh',run)
 z.writestr('Tower30Godot/RUN.txt','Requires Linux x86_64, Godot 4.6.2 .NET and .NET 9 SDK. Open project.godot, build C# and run. Or set GODOT to the full .NET engine path and run bash RUN.sh. The shared TS bundle, original data, all 42 sprites and native QuickJS library are included. No Node game server or sibling project is required. This is an editor-runnable project, not an exported game or APK. Web editor import/Play workflow: PROJECT-HANDOFF-STATUS.md. Native campaign features: GODOT-FLOW-STATUS.md.\n')
 for p in ['docs/PROJECT-HANDOFF-STATUS.md','docs/GODOT-FLOW-STATUS.md','docs/GODOT-BRIDGE-STATUS.md']:z.write(p,'Tower30Godot/'+Path(p).name)
 for d in ['src/core','src/bridge','src/battle-view']:
  for p in Path(d).rglob('*'):
   if p.is_file() and p.suffix in ['.ts','.json']:z.write(p,'Tower30Godot/shared-ts-source/'+p.as_posix())
 z.write('.tools/quickjs-2026-06-04/source.tar.xz','Tower30Godot/third-party/quickjs-2026-06-04.tar.xz')
 z.writestr('Tower30Godot/third-party/SOURCE.txt','https://bellard.org/quickjs/quickjs-2026-06-04.tar.xz\nSHA256 b376e839b322978313d929fd20663b11ba58b75df5a46c126dd19ea2fa70ad2a\nRaw TS is included for review; rebuild in the main tower30-web repository.\n')
with zipfile.ZipFile(out) as z:
 assert z.testzip() is None
 z.extractall(art/'package-check')
manifest={'filename':out.name,'bytes':out.stat().st_size,'sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'zipIntegrity':'passed','type':'Linux x86_64 Godot 4.6.2 .NET editor-runnable project; not exported game/APK','generated':json.loads((project/'generated/manifest.json').read_text())}
(art/'package-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps(manifest))

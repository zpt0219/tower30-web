"""Deploy the static build and one card to the existing local Nginx portal. No other app sources are changed."""
from pathlib import Path
import hashlib,json,os,shutil,subprocess
from datetime import datetime
root=Path(__file__).resolve().parents[1]
os.chdir(root)
art=Path(os.environ.get('TOWER_ARTIFACT_DIR') or Path('.artifact-dir').read_text().strip())
art.mkdir(parents=True,exist_ok=True)
portal=Path('/var/www/portal/index.html');config=Path('/etc/nginx/sites-available/portal')
original=portal.read_text();nginx=config.read_text()
(art/'portal.before.html').write_text(original);(art/'nginx.before.conf').write_text(nginx)
card=Path('deploy/portal-card.html').read_text()
start='      <!-- Tower30 portal card: managed by tower30-web -->'
end='      <!-- End Tower30 portal card -->'
if start in original:
 a=original.index(start);b=original.index(end,a)+len(end)
 updated=original[:a]+card.rstrip()+original[b:]
else:
 marker='      <!-- Card 4: More / System Info -->'
 if marker not in original:raise RuntimeError('Portal insertion point not found; no files changed')
 updated=original.replace(marker,card+'\n'+marker,1)
style='''    /* Tower30 portal accent */
    .card-tower30 { --accent-gradient: linear-gradient(90deg, #65a76c, #e9c879); --card-hover-border: rgba(163, 217, 165, 0.45); }
'''
if '/* Tower30 portal accent */' not in updated:updated=updated.replace('    .card-more {',style+'    .card-more {',1)
health='''      // Tower30 static release health
      try {
        const res = await fetch('/api/check/tower30', { method: 'GET', cache: 'no-store' });
        const release = res.ok ? await res.json() : null;
        const ready = !!release && release.app === 'tower30-web' && release.status === 'ok';
        setStatus('status-tower30', ready, ready ? `在线 · v${release.version}` : '离线');
      } catch (e) { setStatus('status-tower30', false, '离线'); }
'''
if '// Tower30 static release health' not in updated:
 marker='    function setStatus(elementId, isOnline, text) {'
 pos=updated.index(marker);before=updated[:pos];close=before.rfind('    }')
 updated=updated[:close]+health+updated[close:]
shortcut="      if (e.key === '6') document.getElementById('link-tower30').click();"
if shortcut not in updated:updated=updated.replace("      if (e.key === '5') document.getElementById('link-tilemap-hd2d').click();", "      if (e.key === '5') document.getElementById('link-tilemap-hd2d').click();\n"+shortcut)
snippet=Path('deploy/nginx-tower30.conf').read_text()
ngstart='    # Tower30 static web app: managed by tower30-web';ngend='    # End Tower30 static web app'
if ngstart in nginx:
 a=nginx.index(ngstart);b=nginx.index(ngend,a)+len(ngend);newng=nginx[:a]+snippet.rstrip()+nginx[b:]
else:
 pos=nginx.rfind('}');newng=nginx[:pos]+snippet+nginx[pos:]
(art/'portal.after.html').write_text(updated);(art/'nginx.after.conf').write_text(newng)
version=json.loads(Path('package.json').read_text())['version']
build=Path('dist')
if not (build/'index.html').is_file():raise RuntimeError('Run npm run build first')
release={'app':'tower30-web','status':'ok','version':version,'base':'/tower30/','builtAt':datetime.now().astimezone().isoformat(),'files':{p.relative_to(build).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(build.rglob('*')) if p.is_file()}}
(art/'release.json').write_text(json.dumps(release,ensure_ascii=False,indent=2)+'\n')
# Refuse concurrent edits between preparation and installation.
if portal.read_text()!=original or config.read_text()!=nginx:raise RuntimeError('Portal changed concurrently; no files changed')
def sudo(*args):subprocess.run(['sudo','-n',*map(str,args)],check=True)
stamp=datetime.now().strftime('%y%m%d_%H%M%S');stage=Path('/var/www/portal')/('.tower30-stage-'+stamp);target=Path('/var/www/portal/tower30')
sudo('mkdir','-p',stage);sudo('cp','-r',str(build)+'/.',stage);sudo('install','-m','644',art/'release.json',stage/'release.json');sudo('chmod','-R','a+rX',stage)
if target.exists():sudo('mv',target,Path('/var/www/portal')/('.tower30-previous-'+stamp))
sudo('mv',stage,target)
try:
 sudo('install','-m','644',art/'nginx.after.conf',config)
 sudo('nginx','-t')
 sudo('install','-m','644',art/'portal.after.html',portal)
 sudo('systemctl','reload','nginx')
except Exception:
 sudo('install','-m','644',art/'nginx.before.conf',config);sudo('install','-m','644',art/'portal.before.html',portal);sudo('nginx','-t');sudo('systemctl','reload','nginx');raise
(art/'deployment.json').write_text(json.dumps({'version':version,'homepage':'http://192.168.68.108/','app':'http://192.168.68.108/tower30/','health':'http://192.168.68.108/api/check/tower30','target':str(target),'nginxConfig':str(config),'portal':str(portal),'backupDirectory':str(art)},indent=2)+'\n')
print('Deployed tower30-web v'+version+' at http://192.168.68.108/tower30/')

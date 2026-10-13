"""Validación estática reproducible. No necesita acceso a SQL Server."""
from pathlib import Path
import ast,json,re,shutil,subprocess,sys,tempfile
ROOT=Path(__file__).resolve().parents[1]
SKIP={'.venv','venv','node_modules','__pycache__','.pytest_cache','.seprigua-private','uploads','test-results'}
def files():return [p for p in ROOT.rglob('*') if p.is_file() and not any(x in SKIP for x in p.relative_to(ROOT).parts)]
def assets():
    missing=[];referenced=set();allfiles=files()
    for p in allfiles:
        if p.suffix.lower() not in {'.html','.css','.js','.py','.webmanifest'}:continue
        text=p.read_text(encoding='utf-8-sig')
        matches=re.findall(r'''(?:src|href)=["']([^"']+)|url\(\s*["']?([^\s)'";]+)''',text)
        matches+=[(m,'') for m in re.findall(r'''["'](/(?:css|java|img|images|assets)/[^"'${}?<> ]+)["']''',text)]
        for pair in matches:
            raw=next(x for x in pair if x);raw=raw.split('?')[0].split('#')[0]
            if not raw or raw.startswith(('http:','https:','data:','blob:','//')) or any(x in raw for x in ('${','{{')):continue
            if Path(raw).suffix.lower() not in {'.css','.js','.svg','.png','.jpg','.jpeg','.webp','.ico','.woff','.woff2','.webmanifest','.mp4'}:continue
            target=ROOT/raw.lstrip('/') if raw.startswith('/') else p.parent/raw
            target=target.resolve();referenced.add(target)
            if not target.is_file():missing.append((str(p.relative_to(ROOT)),raw))
    unused=[str(p.relative_to(ROOT)) for p in allfiles if p.suffix in {'.css','.js'} and p.resolve() not in referenced and p.name!='service-worker.js']
    return sorted(set(missing)),sorted(unused)
def main():
    errors=[];node=shutil.which('node');count=0
    for p in files():
        if p.suffix=='.py':
            try:ast.parse(p.read_text(encoding='utf-8-sig'),filename=str(p));count+=1
            except SyntaxError as e:errors.append(str(e))
        if p.suffix in {'.json','.webmanifest'}:
            try:json.loads(p.read_text(encoding='utf-8-sig'))
            except ValueError as e:errors.append(str(p)+': '+str(e))
        if p.suffix in {'.js','.cjs'} and node:
            r=subprocess.run([node,'--check',str(p)],capture_output=True,text=True)
            if r.returncode:errors.append(r.stderr)
        if p.suffix=='.html' and node:
            for script in re.findall(r'<script\b[^>]*>(.*?)</script>',p.read_text(encoding='utf-8-sig'),re.S|re.I):
                if not script.strip():continue
                r=subprocess.run([node,'--check'],input=script,text=True,capture_output=True)
                if r.returncode:errors.append(str(p)+': '+r.stderr)
    missing,unused=assets();errors.extend('Referencia ausente: '+str(x) for x in missing)
    result={'python_compilado':count,'javascript_verificado':bool(node),'referencias_ausentes':missing,'css_js_sin_referencia_estatica':unused,'errores':errors}
    print(json.dumps(result,ensure_ascii=False,indent=2));return bool(errors)
if __name__=='__main__':sys.exit(main())

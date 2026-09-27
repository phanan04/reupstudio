"""Install an official, checksum-verified portable Ollama runtime; no system changes."""
import hashlib, json, pathlib, urllib.request, zipfile
root = pathlib.Path(__file__).resolve().parents[1]
folder = root / 'tools' / 'ollama'
folder.mkdir(parents=True, exist_ok=True)
def read(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent':'VietStudio'}), timeout=120)
release = json.load(read('https://api.github.com/repos/ollama/ollama/releases/latest'))
asset = next(a for a in release['assets'] if a['name'] == 'ollama-windows-amd64.zip')
checks = next(a for a in release['assets'] if a['name'] == 'sha256sum.txt')
lines = read(checks['browser_download_url']).read().decode().splitlines()
expected = next(line.split()[0] for line in lines if line.split() and pathlib.PurePosixPath(line.split()[-1].lstrip('*')).name == asset['name'])
archive = folder / asset['name']
if not archive.exists():
    print('Downloading official Ollama '+release['tag_name'], flush=True)
    with read(asset['browser_download_url']) as response, archive.with_suffix('.part').open('wb') as out:
        while chunk := response.read(1024*1024): out.write(chunk)
    archive.with_suffix('.part').rename(archive)
actual = hashlib.file_digest(archive.open('rb'), 'sha256').hexdigest()
if actual != expected: raise RuntimeError('Ollama checksum mismatch')
with zipfile.ZipFile(archive) as z:
    for item in z.infolist():
        target = (folder / item.filename).resolve()
        if not target.is_relative_to(folder.resolve()): raise RuntimeError('Invalid archive path')
    z.extractall(folder)
(folder/'provenance.json').write_text(json.dumps({'version':release['tag_name'],'url':asset['browser_download_url'],'sha256':actual},indent=2))
print('Ollama portable ready: '+str(folder/'ollama.exe'), flush=True)

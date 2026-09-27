"""Read selected files from official release ZIP with HTTP Range, CRC and Authenticode verification.
This installs CPU/Vulkan only. It does not claim whole-archive SHA verification.
"""
import io, json, pathlib, urllib.request, zipfile, hashlib, subprocess, shutil
ROOT=pathlib.Path(__file__).resolve().parents[1]
DEST=ROOT/'tools'/'ollama-local'
DEST.mkdir(parents=True,exist_ok=True)
def request(url,byte_range=None):
    headers={'User-Agent':'VietStudio'}
    if byte_range: headers['Range']=f'bytes={byte_range[0]}-{byte_range[1]}'
    r=urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=120)
    if byte_range and r.status!=206: raise RuntimeError('Server did not honor HTTP Range')
    return r.read()
release=json.loads(request('https://api.github.com/repos/ollama/ollama/releases/latest'))
asset=next(a for a in release['assets'] if a['name']=='ollama-windows-amd64.zip')
size=asset['size'];url=asset['browser_download_url'];tail=request(url,(size-65536,size-1))
class Remote(io.RawIOBase):
    def __init__(self):self.pos=0;self.ranges=[(size-len(tail),tail)]
    def seekable(self):return True
    def seek(self,offset,whence=0):
        self.pos=offset if whence==0 else (self.pos if whence==1 else size)+offset
        return self.pos
    def tell(self):return self.pos
    def read(self,n=-1):
        end=size if n<0 else min(size,self.pos+n)
        for start,data in self.ranges:
            if start<=self.pos and end<=start+len(data):
                out=data[self.pos-start:end-start];self.pos=end;return out
        out=request(url,(self.pos,end-1));self.ranges.append((self.pos,out));self.pos=end;return out
r=Remote();z=zipfile.ZipFile(r)
start=next(i.header_offset for i in z.infolist() if i.filename=='lib/ollama/ggml-base.dll')
print(f'Downloading CPU/Vulkan region: {(size-start)/1024**2:.1f} MB',flush=True)
r.ranges.append((start,request(url,(start,size-1))))
files=[]
for item in z.infolist():
    if item.is_dir() or '/cuda_' in item.filename:continue
    target=(DEST/item.filename).resolve()
    if not target.is_relative_to(DEST.resolve()):raise RuntimeError('Invalid ZIP path')
    data=z.read(item) # zipfile verifies CRC for every extracted member.
    target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
    files.append({'path':item.filename,'sha256':hashlib.sha256(data).hexdigest(),'crc32':item.CRC})
check=subprocess.run([shutil.which('pwsh') or 'powershell','-NoProfile','-Command',f"$s=Get-AuthenticodeSignature -LiteralPath '{DEST/'ollama.exe'}'; $s.Status; $s.SignerCertificate.Subject; if($s.Status -ne 'Valid'){{exit 1}}"],capture_output=True,text=True)
print(check.stdout,flush=True)
if check.returncode:raise RuntimeError('Ollama Authenticode verification failed: '+check.stderr)
(DEST/'provenance.json').write_text(json.dumps({'version':release['tag_name'],'url':url,'verification':'HTTPS official release; ZIP member CRC; valid executable Authenticode; per-file SHA256 inventory','files':files},indent=2))
print('Portable CPU/Vulkan Ollama ready',flush=True)

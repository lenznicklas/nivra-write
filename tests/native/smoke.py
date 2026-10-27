#!/usr/bin/env python3
"""Linux release smoke test using installed WebKitWebDriver; no Python packages.
Run after `npm run tauri build`: python3 tests/native/smoke.py
Uses isolated temporary data and documents, then closes its own app/driver.
"""
import base64
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import signal
import tempfile
import time
import urllib.error
import urllib.request
import uuid
import zipfile
import struct
import zlib
import random

ROOT = Path(__file__).resolve().parents[2]
BINARY = ROOT / 'src-tauri/target/release/nivra-writer'


def wait_for(predicate, seconds=15):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(.1)
    raise AssertionError('Timed out waiting for native application state')


def main():
    if not BINARY.exists() or not shutil.which('WebKitWebDriver'):
        raise SystemExit('Build the release binary and install WebKitWebDriver first.')
    with tempfile.TemporaryDirectory(prefix='nivra-native-test-') as folder:
        data = Path(folder)
        path = data / 'Native verification.nwr'
        recovery_dir = data / 'app.nivra.writer/recovery'
        recovery_dir.mkdir(parents=True)
        source=data/'original-image.png'
        def chunk(kind,body):return struct.pack('>I',len(body))+kind+body+struct.pack('>I',zlib.crc32(kind+body)&0xffffffff)
        source.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',4,4,8,6,0,0,0))+chunk(b'IDAT',zlib.compress((b'\x00'+bytes([69,107,80,255])*4)*4))+chunk(b'IEND',b''))
        def packaged_document(path):
            with zipfile.ZipFile(path) as package:return json.loads(package.read('document.json'))
        doc_id = str(uuid.uuid4())
        now = '2026-01-01T12:00:00.000Z'
        document = {'formatVersion': 1, 'metadata': {'id': doc_id, 'title': 'Native verification', 'createdAt': now, 'modifiedAt': now, 'author': '', 'applicationVersion': '0.1.0'}, 'pageSettings': {'size': 'A4', 'orientation': 'portrait', 'margins': {'top': 25, 'right': 25, 'bottom': 25, 'left': 25}}, 'content': {'type': 'doc', 'content': [{'type': 'paragraph', 'content': [{'type': 'text', 'text': 'Recovered original.'}]}]}}
        snapshot = recovery_dir / f'{doc_id}.json'
        snapshot.write_text(json.dumps({'document': document, 'path': str(path), 'savedAt': now}))
        with socket.socket() as reservation:
            reservation.bind(('127.0.0.1', 0))
            port = reservation.getsockname()[1]
        env = {**os.environ, 'XDG_DATA_HOME': folder, 'XDG_CACHE_HOME': str(data / 'cache'), 'GDK_BACKEND': 'x11', 'GTK_USE_PORTAL': '0', 'TAURI_WEBVIEW_AUTOMATION': 'true'}
        with open(data / 'driver.log', 'w') as log:
            driver = subprocess.Popen(['WebKitWebDriver', f'--port={port}'], env=env, stdout=log, stderr=log, start_new_session=True)
            base = f'http://127.0.0.1:{port}'
            session = None

            def request(method, endpoint, body=None):
                payload = None if body is None else json.dumps(body).encode()
                req = urllib.request.Request(base + endpoint, data=payload, method=method, headers={'Content-Type': 'application/json'})
                try:
                    response = urllib.request.urlopen(req, timeout=30)
                    value = json.load(response)['value']
                except urllib.error.HTTPError as error:
                    raise AssertionError(error.read().decode()) from error
                return value

            def ready():
                try:
                    request('GET', '/status')
                    return True
                except urllib.error.URLError:
                    return False

            try:
                wait_for(ready)
                result = request('POST', '/session', {'capabilities': {'alwaysMatch': {'webkitgtk:browserOptions': {'binary': str(BINARY)}}}})
                session = result['sessionId']
                native_pid=result['capabilities']['webkit:processID']
                prefix = f'/session/{session}'

                def execute(script, *args):
                    return request('POST', prefix + '/execute/sync', {'script': script, 'args': list(args)})

                def click_text(text):
                    assert execute("const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===arguments[0]);if(b){b.click();return true;}return false;", text), f'Missing button {text}'

                def invoke(command, args=None):
                    value = request('POST', prefix + '/execute/async', {'script': "const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(value=>done({value}),error=>done({error:String(error)}));", 'args': [command, args or {}]})
                    return value

                def editor_text():
                    return execute("return document.querySelector('.tiptap')?.textContent || ''")

                def type_text(text):
                    element = request('POST', prefix + '/element', {'using': 'css selector', 'value': '.tiptap'})
                    element_id = element['element-6066-11e4-a52e-4f735466cecf']
                    request('POST', prefix + f'/element/{element_id}/value', {'text': text})

                wait_for(lambda: execute("return !!document.querySelector('.recovery-list')"))
                click_text('Recover')
                wait_for(lambda: editor_text() == 'Recovered original.')
                type_text(' Native typing.')
                assert 'Native typing.' in editor_text()
                execute("document.querySelector('[aria-label=\"Save document · Ctrl+S\"]').click()")
                wait_for(path.exists)
                saved = packaged_document(path)
                assert saved['formatVersion']==2
                assert Path(str(path)+'.bak').exists() is False
                assert 'Native typing.' in json.dumps(saved['content'])
                wait_for(lambda: not snapshot.exists())
                wait_for(lambda: execute("return document.querySelector('.save-state')?.textContent.trim().startsWith('Saved')"))
                assert 'Native verification — Nivra Writer' in request('GET', prefix + '/title')
                execute("document.querySelector('.brand').click()")
                wait_for(lambda: execute("return !!document.querySelector('.recent-list')"))
                execute("document.querySelector('.recent-list button').click()")
                wait_for(lambda: 'Native typing.' in editor_text())
                execute("document.querySelector('[aria-label=Settings]').click()")
                wait_for(lambda: execute("return !!document.querySelector('dialog[open]')"))
                execute("const s=document.querySelector('select[aria-label=Theme]');s.value='dark';s.dispatchEvent(new Event('change',{bubbles:true}));const i=document.querySelector('input[min=\"5\"]');i.value='5';i.dispatchEvent(new Event('input',{bubbles:true}));const z=document.querySelector('.settings-body input[min=\"50\"]');z.value='125';z.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('input[type=checkbox]').click();const p=Array.from(document.querySelectorAll('.settings-body select')).find(s=>Array.from(s.options).some(o=>o.value==='Letter'));p.value='Letter';p.dispatchEvent(new Event('change',{bubbles:true}));")
                click_text('Save settings')
                settings_file = data / 'app.nivra.writer/settings.json'
                wait_for(settings_file.exists)
                persisted=json.loads(settings_file.read_text())
                assert persisted=={'theme':'dark','defaultZoom':125,'autosave':True,'autosaveInterval':5,'outline':False,'pageSize':'Letter'},persisted
                # Native drop follows the same session-owned import pipeline as the image picker.
                event=invoke('plugin:event|emit', {'event':'tauri://drag-drop','payload':{'paths':[str(source)],'position':{'x':400,'y':300}}})
                assert event=={'value':None},event
                wait_for(lambda: execute("return document.querySelectorAll('.tiptap img').length===1"))
                wait_for(lambda: execute("const image=document.querySelector('.tiptap img');return image.complete&&image.naturalWidth===4"))
                invoke('plugin:event|emit', {'event':'tauri://drag-drop','payload':{'paths':[str(source)],'position':{'x':400,'y':300}}})
                wait_for(lambda: execute("return document.querySelectorAll('.tiptap img').length===2"))
                execute("document.querySelector('[aria-label=\"Save document · Ctrl+S\"]').click()")
                wait_for(lambda: execute("return document.querySelector('.save-state')?.textContent.trim().startsWith('Saved')"))
                saved=packaged_document(path)
                assert len(saved['assets'])==1,'Identical images were not deduplicated'
                assert 'data:image/' not in json.dumps(saved['content']) and 'asset://' in json.dumps(saved['content'])
                assert source.name not in json.dumps(saved)
                source.unlink()
                moved=data/'Moved document.nwr'
                path.rename(moved)
                old_source=execute("return document.querySelector('.tiptap img').src")
                invoke('plugin:event|emit', {'event':'tauri://drag-drop','payload':{'paths':[str(moved)],'position':{'x':400,'y':300}}})
                wait_for(lambda: execute("return document.querySelectorAll('.tiptap img').length===2"))
                wait_for(lambda: execute("return Array.from(document.querySelectorAll('.tiptap img')).every(image=>image.complete&&image.naturalWidth===4)"))
                wait_for(lambda:execute("return document.querySelector('.tiptap img')?.src!==arguments[0]",old_source))
                path=moved
                # Restore creates a new revision/session and the original recovery ID is retired after save.
                before=path.read_bytes()
                type_text(' Recovery addition.')
                wait_for(lambda: bool(list(recovery_dir.glob('*.nwr'))),12)
                snapshot=list(recovery_dir.glob('*.nwr'))[0]
                assert 'Recovery addition.' in json.dumps(packaged_document(snapshot))
                assert path.read_bytes()==before,'Recovery overwrote the original document'
                with zipfile.ZipFile(snapshot) as package:
                    metadata=json.loads(package.read('metadata.json'))['recovery']
                    assert metadata['editRevision']>0 and metadata['documentId']==doc_id and metadata['path']==str(path)
                    assert len([name for name in package.namelist() if name.startswith('assets/')])==1
                loaded=invoke('read_document',{'path':str(path)})['value']
                assert loaded['document']['formatVersion']==2
                loaded_session=loaded['sessionId']
                future = data / 'future.nwr'
                future.write_text(json.dumps({**document, 'formatVersion': 99}))
                assert 'version' in invoke('read_document', {'path': str(future)})['error']
                (recovery_dir / 'broken.json').write_text('{bad')
                catalog = invoke('list_recovery')['value']
                assert len(catalog['snapshots'])==1 and len(catalog['issues'])==1
                assert catalog['snapshots'][0]['originalExists'] is True
                assert 'document' not in catalog['snapshots'][0],'Recovery listing returned full document content'
                assert catalog['snapshots'][0]['editRevision']==metadata['editRevision']
                restored=invoke('restore_recovery',{'id':metadata['recoveryId']})['value']
                assert len(restored['document']['assets'])==1
                invoke('close_asset_session',{'sessionId':restored['sessionId']})
                exported_html=data/'export.html'
                html=execute("return document.querySelector('.tiptap').innerHTML")
                # Generated persisted HTML uses logical IDs, while the NodeView DOM uses scoped URLs.
                asset_id=next(iter(saved['assets']))
                html=f'<img src="asset://{asset_id}">' 
                assert invoke('export_html',{'path':str(exported_html),'content':html,'sessionId':loaded_session})=={'value':None}
                assert 'data:image/png;base64,' in exported_html.read_text()
                # Native package/import timings use a deterministic ~4 MB raster; original bytes are retained.
                noise=data/'performance.png'
                rows=random.Random(42).randbytes(1024*1024*4)
                raw=b''.join(b'\x00'+rows[y*4096:(y+1)*4096] for y in range(1024))
                noise.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',1024,1024,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(raw))+chunk(b'IEND',b''))
                start=time.monotonic();imported=invoke('import_image',{'path':str(noise),'sessionId':loaded_session})['value'];import_ms=(time.monotonic()-start)*1000
                benchmark=loaded['document'];benchmark['assets'][imported['id']]=imported['entry'];benchmark['content']['content'].append({'type':'image','attrs':{'src':'asset://'+imported['id']}})
                benchmark_path=data/'benchmark.nwr'
                start=time.monotonic();receipt=invoke('write_document',{'path':str(benchmark_path),'document':benchmark,'sessionId':loaded_session})['value'];save_ms=(time.monotonic()-start)*1000
                start=time.monotonic();reopened=invoke('read_document',{'path':str(benchmark_path)})['value'];open_ms=(time.monotonic()-start)*1000
                assert len(reopened['document']['assets'])==2
                invoke('close_asset_session',{'sessionId':reopened['sessionId']})
                print(f'Native ~4 MB raster: import {import_ms:.1f} ms, package save {save_ms:.1f} ms, package open {open_ms:.1f} ms; {receipt["size"]} bytes',flush=True)
                invoke('close_asset_session',{'sessionId':loaded_session})
                # Exercise zoom policy with real wheel actions as well as cancelable gesture events.
                policy=execute("const w=new WheelEvent('wheel',{ctrlKey:true,deltaY:-100,cancelable:true});window.dispatchEvent(w);const g=new Event('gesturechange',{cancelable:true});window.dispatchEvent(g);return {wheel:w.defaultPrevented,gesture:g.defaultPrevented,scale:window.visualViewport.scale};")
                assert policy['wheel'] and policy['gesture'] and policy['scale']==1
                export = data / 'export.txt'
                assert invoke('export_file', {'path': str(export), 'content': 'Native export'}) == {'value': None}
                assert export.read_text() == 'Native export'
                png = request('GET', prefix + '/screenshot')
                Path('/tmp/nivra-native-verified.png').write_bytes(base64.b64decode(png))
                # Abrupt app termination leaves the independent recovery package intact.
                os.kill(native_pid,signal.SIGKILL)
                try:request('DELETE',prefix)
                except Exception:pass
                result=request('POST','/session',{'capabilities':{'alwaysMatch':{'webkitgtk:browserOptions':{'binary':str(BINARY)}}}})
                session=result['sessionId'];prefix=f'/session/{session}'
                wait_for(lambda:execute("return document.documentElement.dataset.theme==='dark'&&!!document.querySelector('.recovery-list')"))
                assert invoke('read_state',{'key':'settings'})['value']==persisted
                assert len(list((data/'cache/app.nivra.writer/asset-sessions').glob('writer-*')))==1,'Stale asset sessions were not cleaned'
                click_text('Recover')
                wait_for(lambda:'Recovery addition.' in editor_text())
                assert execute("return !document.querySelector('.outline')&&document.querySelector('.zoom-value').textContent==='125%'")
                wait_for(lambda:execute("return Array.from(document.querySelectorAll('.tiptap img')).length===2&&Array.from(document.querySelectorAll('.tiptap img')).every(i=>i.complete&&i.naturalWidth===4)"))
                # Remaining corrupt candidates report an error without preventing recovery.
                execute("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Got it')?.click()")
                # Restart again with corrupt settings; defaults must load safely.
                request('DELETE',prefix);session=None
                settings_file.write_text('{broken settings')
                path.rename(data/'Moved again.nwr')
                result=request('POST','/session',{'capabilities':{'alwaysMatch':{'webkitgtk:browserOptions':{'binary':str(BINARY)}}}})
                session=result['sessionId'];prefix=f'/session/{session}'
                wait_for(lambda:execute("return document.documentElement.dataset.theme==='system'&&!!document.querySelector('.recovery-list')"))
                assert (settings_file.with_suffix('.corrupt.json')).exists()
                candidates=invoke('list_recovery')['value']['snapshots']
                assert candidates[0]['originalExists'] is False
                execute("Array.from(document.querySelectorAll('dialog[open]')).at(-1).querySelector('[aria-label=\"Close dialog\"]').click()")
                execute("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Got it')?.click()")
                wait_for(lambda:execute("return !!document.querySelector('.recent-row.unavailable')"))
                while execute("return document.querySelectorAll('.recent-row.unavailable').length"):
                    count=execute("return document.querySelectorAll('.recent-row.unavailable').length")
                    execute("document.querySelector('.recent-row.unavailable .remove-recent').click()")
                    wait_for(lambda:execute("return document.querySelectorAll('.recent-row.unavailable').length")<count)
                print('PASS: native startup, v1 migration, recovery restore, typing, ZIP save, recent reopen, settings, image drop/deduplication/rendering, source deletion, portable moved package, packaged autosave, revision metadata, version rejection, corrupt snapshot isolation, native export, zoom policy.')
            finally:
                if session and sys.exc_info()[0]:
                    try:
                        print('Native failure state:', execute('return document.body.innerText'))
                        png=request('GET',prefix+'/screenshot')
                        Path('/tmp/nivra-native-failure.png').write_bytes(base64.b64decode(png))
                    except Exception as error:
                        print('Failed to collect diagnostic:',error)
                if session:
                    try:
                        request('DELETE', f'/session/{session}')
                    except Exception as error:
                        print(f'Driver cleanup: {error}')
                try:
                    os.killpg(driver.pid,signal.SIGTERM)
                except ProcessLookupError:
                    pass
                driver.wait(timeout=10)
                time.sleep(.5) # WebKit auxiliary processes can flush caches after session deletion.


if __name__ == '__main__':
    main()

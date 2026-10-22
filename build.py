"""Assemble the single-page editor from src/ into:
  dist/ff13-save-editor.html  - standalone page (open in any browser)
  app/index.html              - page for the desktop app (uses a bundled copy of pako)
"""
import json, os, re

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, 'src')
CDN_PAKO = '<script src="https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js"></script>'

def read(name):
    with open(os.path.join(SRC, name), encoding='utf-8') as f:
        return f.read()

def strip_export(js):
    return re.sub(r"\nif \(typeof module !== 'undefined'\) module\.exports = \w+;\n", "\n", js)

def page():
    tpl = read('page.tpl.html')
    data = json.dumps(json.loads(read('data.json')), separators=(',', ':'))
    body = (tpl.replace('/*CORE*/', strip_export(read('core.js')))
               .replace('/*HM*/', strip_export(read('hardmode.js')))
               .replace('/*DATA*/', data))
    for marker in ('/*CORE*/', '/*HM*/', '/*DATA*/'):
        assert marker not in body, marker
    assert CDN_PAKO in body
    head = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n</head>\n<body>\n')
    return head, body

def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)

if __name__ == '__main__':
    head, body = page()
    write(os.path.join(ROOT, 'dist', 'ff13-save-editor.html'), head + body + '\n</body>\n</html>\n')
    write(os.path.join(ROOT, 'app', 'index.html'), head + body.replace(CDN_PAKO, '<script src="pako.min.js"></script>') + '\n</body>\n</html>\n')
    print('Built dist/ff13-save-editor.html and app/index.html')

"""Validate the actual browser downloads with Python's standard library only."""
import json
from pathlib import Path
import os
import zipfile
import xml.etree.ElementTree as ET

root = Path(os.environ.get('BROWSER_OUTPUT', '.browser-results'))
ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(root / 'stage3-february.xlsx') as archive:
    assert archive.testzip() is None
    for name in archive.namelist():
        if name.endswith('.xml') or name.endswith('.rels'):
            ET.fromstring(archive.read(name))
    workbook = ET.fromstring(archive.read('xl/workbook.xml'))
    assert len(workbook.findall('s:sheets/s:sheet', ns)) == 4
    summary = ET.fromstring(archive.read('xl/worksheets/sheet1.xml'))
    cells = {c.attrib['r']: c for c in summary.findall('.//s:c', ns)}
    for ref, expected in {'B4': 7000, 'B5': 0, 'B6': 500, 'B7': 0, 'B8': 6500}.items():
        assert float(cells[ref].find('s:v', ns).text) == expected
    assert cells['B8'].find('s:f', ns).text == 'B4+B5-B6-B7'
    ledger = ET.fromstring(archive.read('xl/worksheets/sheet4.xml'))
    values = [float(c.find('s:v', ns).text) for c in ledger.findall('.//s:c', ns) if c.find('s:v', ns) is not None]
    assert values == [-500, 6500], values
with zipfile.ZipFile(root / 'stage3-warning.xlsx') as archive:
    summary = ET.fromstring(archive.read('xl/worksheets/sheet1.xml'))
    assert 'legacySalary' in ''.join(summary.itertext())
for name in ('stage3-finance.xls', 'stage3-warning.xls'):
    ET.parse(root / name)
backup = json.loads((root / 'stage3-synthetic-backup.json').read_text(encoding='utf-8'))
assert backup['version'] == 3 and backup['financeHistory']
print('XLSX ZIP/XML, four sheets, formula/cache, cash ledger, duplicate warning, XML Excel and JSON: PASS')

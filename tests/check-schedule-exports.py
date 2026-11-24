"""Check the generated spreadsheet parts, including their order in SpreadsheetML."""
import os
from pathlib import Path
import xml.etree.ElementTree as ET
from zipfile import ZipFile

root = Path(os.environ.get('BROWSER_OUTPUT', '.browser-results'))
ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
ss = {'ss': 'urn:schemas-microsoft-com:office:spreadsheet'}
colors = [
    ('FFA61B1B', 'FFFCE2E2'),
    ('FF146C43', 'FFDCF6E8'),
    ('FF805200', 'FFFFE8B3'),
]


def tags(element):
    return [child.tag.rsplit('}', 1)[-1] for child in element]


def cells(sheet):
    return {cell.attrib['r']: cell for cell in sheet.findall('.//s:c', ns)}


def read_xlsx(name, *, schedule=False):
    with ZipFile(root / name) as archive:
        assert archive.testzip() is None, name
        parts = {part: ET.fromstring(archive.read(part)) for part in archive.namelist()
                 if part.endswith(('.xml', '.rels'))}
    dxfs = parts['xl/styles.xml'].find('s:dxfs', ns)
    assert int(dxfs.attrib['count']) == len(dxfs) == (20 if schedule else 3), name
    if schedule:
        for dxf in dxfs:
            assert tags(dxf) in (['font', 'fill'], ['font'], ['fill'], ['numFmt']), (name, tags(dxf))
            pattern = dxf.find('s:fill/s:patternFill', ns)
            if pattern is not None:
                assert pattern.find('s:fgColor', ns).attrib == pattern.find('s:bgColor', ns).attrib
        return parts
    for dxf, (font, fill) in zip(dxfs, colors):
        assert tags(dxf) == ['font', 'fill'], (name, tags(dxf))
        assert dxf.find('s:font/s:color', ns).attrib['rgb'] == font
        assert dxf.find('s:fill/s:patternFill/s:fgColor', ns).attrib['rgb'] == fill
        assert dxf.find('s:fill/s:patternFill/s:bgColor', ns).attrib['rgb'] == fill
    return parts


def check_order(sheet, *tail):
    assert tags(sheet) == ['sheetViews', 'sheetFormatPr', 'cols', 'sheetData', *tail, 'pageMargins'], tags(sheet)


def val(grid, address):
    return grid[address].findtext('s:v', namespaces=ns)


def inline(grid, address):
    return grid[address].findtext('s:is/s:t', namespaces=ns)


def formula(grid, address):
    return grid[address].findtext('s:f', namespaces=ns)


def schedule_parts(name):
    book = read_xlsx(name, schedule=True)
    meta = book['xl/workbook.xml']
    assert [s.attrib['name'] for s in meta.findall('s:sheets/s:sheet', ns)] == ['График', 'Сводка']
    assert meta.find('s:calcPr', ns).attrib['fullCalcOnLoad'] == '1'
    graph, summary = (book[f'xl/worksheets/sheet{i}.xml'] for i in (1, 2))
    assert graph.find('s:pageSetup', ns).attrib == {
        'paperSize': '8', 'orientation': 'landscape', 'fitToWidth': '1', 'fitToHeight': '0'}
    assert graph.find('s:sheetViews/s:sheetView/s:pane', ns).attrib['topLeftCell'] == 'F8'
    assert summary.find('s:sheetViews/s:sheetView/s:pane', ns).attrib['topLeftCell'] == 'C17'
    cols = graph.findall('s:cols/s:col', ns)
    assert len(cols) == 26 and all(float(col.attrib['width']) >= 7 for col in cols[10:24])
    assert all(col.attrib['hidden'] == '1' for col in cols[-2:])
    for sheet in (graph, summary):
        order = tags(sheet)
        assert all(order.index(a) < order.index(b) for a, b in [
            ('sheetViews', 'sheetData'), ('sheetData', 'mergeCells'), ('mergeCells', 'pageMargins')])
        if 'autoFilter' in order:
            assert order.index('sheetData') < order.index('autoFilter') < order.index('mergeCells')
        for tag in ('conditionalFormatting', 'dataValidations'):
            if tag in order:
                assert order.index('mergeCells') < order.index(tag) < order.index('pageMargins')
    return graph, summary


graph, summary = schedule_parts('d01-schedule.xlsx')
grid, totals = cells(graph), cells(summary)
assert graph.find('s:autoFilter', ns) is None
assert summary.find('s:autoFilter', ns).attrib['ref'] == 'A16:S24'
bar = graph.find('s:conditionalFormatting/s:cfRule/s:dataBar', ns)
assert bar.attrib == {'minLength': '0', 'maxLength': '100', 'showValue': '0'}
assert summary.find("s:dataValidations/s:dataValidation[@type='decimal']", ns).attrib['sqref'] == 'I17:I24'
assert graph.find("s:conditionalFormatting[@sqref='K8:X23']", ns) is not None
assert val(grid, 'K6') == '27.12 — 02.01' and val(grid, 'R6') == '03.01 — 09.01'
assert [int(val(grid, f'{col}7')) - int(val(grid, 'K7')) for col in 'KLMNOPQRSTUVWX'] == list(range(14))
assert all('$H$4' in formula(grid, f'{col}7') for col in 'KLMNOPQRSTUVWX')
for i in range(8):
    r, s = 8 + 2*i, 17 + i
    assert [val(grid, f'J{r}'), val(grid, f'J{r+1}')] == ['ПЛАН', 'ФАКТ']
    assert val(grid, f'D{r}') == 'Нет данных'
    assert [val(grid, f'{c}{r+1}') for c in 'HI'] == ['', '']
    assert all(totals[f'{c}{s}'].find('s:v', ns) is None for c in 'FGI')
    assert 'MATCH(' in formula(grid, f'Z{r}') and formula(grid, f'Z{r+1}') == f'$Z{r}'
    assert 'SUBTOTAL(103,' in formula(totals, f'S{s}')
assert [val(grid, f'B{r}') for r in (8, 10, 12, 14, 22)] == [
    'Фундамент', '↳ Фундамент / Армирование', '↳ Фундамент / Армирование',
    'Земляные работы / разработка котлована и вывоз грунта', 'Монтаж опалубки']
assert val(grid, 'F14') == 'Дата финиша неизвестна'
assert 'OR(F20="",G20="",G20>=F20)' in formula(totals, 'K20')
assert 'OR(F20="",G20="",G20>=F20)' in formula(totals, 'Q20')
assert '"<100%"' in formula(grid, 'D14')
formats = read_xlsx('d01-schedule.xlsx', schedule=True)['xl/styles.xml'].findall('s:dxfs/s:dxf/s:numFmt', ns)
assert [f.attrib['formatCode'] for f in formats] == ['0.0#%', '[<1]"<100%";">100%"']
pct_rules = summary.findall("s:conditionalFormatting[@sqref='I17:I24']/s:cfRule", ns)
assert [rule.attrib['dxfId'] for rule in pct_rules] == ['19', '18', '3']
assert val(grid, 'C10') == 'Просрочено' and val(grid, 'F10') == 'Просрочено +2 дн.'
assert val(grid, 'C20') == 'Нет данных'
assert inline(totals, 'L18') == 'Проверить крепления'
assert inline(totals, 'N18') == 'Фундамент' and inline(totals, 'O18') == 'Тестовый объект'
assert [val(totals, f'C{i}') for i in range(6, 13)] == ['1', '1', '1', '3', '1', '7', '0']
assert val(totals, 'I10') == '7'
assert len(set(val(grid, f'A{r}') for r in range(8, 24, 2))) == 8

empty, empty_summary = schedule_parts('vg01-empty.xlsx')
assert empty_summary.find('s:autoFilter', ns) is None
assert val(cells(empty_summary), 'C11') == '0'
assert not any('Сводка' in f.text for f in empty.findall('.//s:f', ns))
single, single_summary = schedule_parts('vg01-mobile.xlsx')
assert val(cells(single), 'H8') == val(cells(single), 'I8')
assert val(cells(single), 'J8') == 'ПЛАН' and val(cells(single), 'J9') == 'ФАКТ'
assert val(cells(single_summary), 'C11') == '1'

for name in ('d01-expenses.xlsx', 'd01-missing-expenses.xlsx', 'd01-advance-missing.xlsx'):
    sheet = read_xlsx(name)['xl/worksheets/sheet1.xml']
    check_order(sheet, 'autoFilter', 'mergeCells')
    assert sheet.find('s:autoFilter', ns).attrib['ref'] == 'A3:I4', name
    assert cells(sheet)['D4'].findtext('s:v', namespaces=ns) == '1234.5', name

warehouse = ET.parse(root / 'd01-warehouse.xls')
assert [sheet.attrib[f'{{{ss["ss"]}}}Name'] for sheet in warehouse.findall('ss:Worksheet', ss)] == ['Остатки', 'История']
warehouse_rows = warehouse.findall('ss:Worksheet/ss:Table/ss:Row', ss)
assert [c.text for c in warehouse_rows[1].findall('ss:Cell/ss:Data', ss)][4:6] == ['5', '3']
assert 'Выдача' in [c.text for c in warehouse_rows[3].findall('ss:Cell/ss:Data', ss)]
timesheet = ET.parse(root / 'd01-timesheet.xls')
assert '6000' in [d.text for d in timesheet.findall('.//ss:Data', ss)]
print('VG01: workbook structure, formulas, empty and single-day exports, expenses, warehouse and timesheet: PASS')

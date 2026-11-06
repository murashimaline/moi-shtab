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


def read_xlsx(name):
    with ZipFile(root / name) as archive:
        assert archive.testzip() is None, name
        parts = {part: ET.fromstring(archive.read(part)) for part in archive.namelist()
                 if part.endswith(('.xml', '.rels'))}
    dxfs = parts['xl/styles.xml'].find('s:dxfs', ns)
    assert dxfs.attrib['count'] == '3' and len(dxfs) == 3, name
    for dxf, (font, fill) in zip(dxfs, colors):
        assert tags(dxf) == ['font', 'fill'], (name, tags(dxf))
        assert dxf.find('s:font/s:color', ns).attrib['rgb'] == font
        assert dxf.find('s:fill/s:patternFill/s:fgColor', ns).attrib['rgb'] == fill
        assert dxf.find('s:fill/s:patternFill/s:bgColor', ns).attrib['rgb'] == fill
    return parts


def check_order(sheet, *tail):
    assert tags(sheet) == ['sheetViews', 'sheetFormatPr', 'cols', 'sheetData', *tail, 'pageMargins'], tags(sheet)


schedule = read_xlsx('d01-schedule.xlsx')
assert [sheet.attrib['name'] for sheet in schedule['xl/workbook.xml'].findall('s:sheets/s:sheet', ns)] == ['График', 'Сводка']
gantt = schedule['xl/worksheets/sheet1.xml']
check_order(gantt, 'autoFilter', 'mergeCells', 'conditionalFormatting', 'conditionalFormatting')
assert gantt.find('s:autoFilter', ns).attrib['ref'] == 'A6:K9'
assert [m.attrib['ref'] for m in gantt.findall('s:mergeCells/s:mergeCell', ns)] == ['A1:K1', 'A2:K2', 'A4:K4', 'A5:K5']
assert gantt.find('s:sheetViews/s:sheetView/s:pane', ns).attrib['topLeftCell'] == 'E7'
groups = gantt.findall('s:conditionalFormatting', ns)
assert [group.attrib['sqref'] for group in groups] == ['A7:K9', 'L7:Y9']
statuses = ['Задержка', 'В срок', 'Запланировано']
for group_index, group in enumerate(groups):
    rules = group.findall('s:cfRule', ns)
    assert len(rules) == 3
    for i, rule in enumerate(rules):
        assert rule.attrib == {'type': 'expression', 'dxfId': str(i), 'priority': str(1 + i + 3 * group_index)}
        status = f'$H7="{statuses[i]}"'
        expected = f'AND(L$6>=$E7,L$6<=$F7,{status})' if group_index else status
        assert rule.findtext('s:formula', namespaces=ns) == expected

grid = cells(gantt)
assert [grid[f'C{i}'].findtext('s:is/s:t', namespaces=ns) for i in range(7, 10)] == [
    'Тестовый этап', '  ↳ Тестовая стадия', 'Будущий этап']
assert grid['M6'].findtext('s:f', namespaces=ns) == 'L6+1'
assert [grid[f'H{i}'].findtext('s:v', namespaces=ns) for i in range(7, 10)] == statuses
assert all(grid[f'{col}{row}'].find('s:f', ns) is not None for row in range(7, 10) for col in 'HIJ')
summary = schedule['xl/worksheets/sheet2.xml']
check_order(summary, 'mergeCells')
totals = cells(summary)
assert [totals[f'B{i}'].findtext('s:v', namespaces=ns) for i in range(4, 10)] == ['2', '1', '1', '1', '1', '3']
assert totals['B9'].findtext('s:f', namespaces=ns) == "COUNTA('График'!C7:C9)"

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
print('D01: XML order, Gantt formulas, three colors, summary, expenses, warehouse and timesheet: PASS')

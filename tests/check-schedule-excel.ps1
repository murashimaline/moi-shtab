param([Parameter(Mandatory)][string]$Workbook)

$ErrorActionPreference = 'Stop'

function Assert-Equal($actual, $expected, $case) {
    if ($actual -cne $expected) {
        throw "$case. Expected [$expected], got [$actual]"
    }
}

$path = (Resolve-Path -LiteralPath $Workbook).Path
$hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
try {
    $book = $excel.Workbooks.Open($path, 0, $true)
    $graph = $book.Worksheets.Item('График')
    $summary = $book.Worksheets.Item('Сводка')
    $planEnd = [double]$summary.Range('E20').Value2
    $early = [double]($planEnd - 1)
    $late = [double]($planEnd + 2)

    # The synthetic completed work has its planned end at N7. Check all 14 actual cells.
    function Assert-Fact($label, $count, $days, [int[]]$filled = @()) {
        $excel.CalculateFull()
        Assert-Equal $graph.Range('C14').Text 'Выполнено' 'Completion status'
        Assert-Equal $graph.Range('F14').Text $label 'Schedule deviation'
        Assert-Equal $summary.Range('Q20').Value2 $days 'Numeric delay'
        Assert-Equal $summary.Range('C12').Value2 $count 'Completed late total'
        for ($col = 11; $col -le 24; $col++) {
            $actual = $graph.Cells.Item(15, $col)
            $labelCell = $graph.Cells.Item(23, $col)
            $hasFill = $actual.DisplayFormat.Interior.Color -ne $labelCell.DisplayFormat.Interior.Color
            Assert-Equal $hasFill ($filled -contains $col) "Actual bar at column $col"
            Assert-Equal $actual.Text '' "Actual marker at column $col"
        }
    }

    $summary.Range('G20').Value2 = $late
    Assert-Fact 'С опозданием +2 дн.' 1 2
    Assert-Equal $graph.Range('H15').Text '' 'Unknown actual start'
    Assert-Equal $graph.Range('I15').Text $graph.Range('P7').Text 'Known actual end'
    $summary.Range('G20').Value2 = $planEnd
    Assert-Fact 'Выполнено в срок' 0 0
    $summary.Range('G20').Value2 = $early
    Assert-Fact 'Выполнено в срок' 0 0
    $summary.Range('G20').ClearContents()
    Assert-Fact 'Дата финиша неизвестна' 0 0
    $summary.Range('G20').Value2 = 'не дата'
    Assert-Fact 'Сверить даты' 0 0
    $summary.Range('G20').Value2 = $late
    $summary.Range('F20').Value2 = 'не дата'
    Assert-Fact 'Сверить даты' 0 0
    $summary.Range('F20').Value2 = [double]($late + 1)
    Assert-Fact 'Сверить даты' 0 0
    $summary.Range('F20').Value2 = $planEnd
    Assert-Fact 'С опозданием +2 дн.' 1 2 @(14, 15, 16)
    "Actual dates, delays, late totals and 14 timeline cells: PASS"

    function Assert-Progress($value, $inputLabel, $graphLabel, $indicator, $warning, $bin) {
        if ($null -eq $value) { $summary.Range('I20').ClearContents() }
        elseif ($value -is [string]) { $summary.Range('I20').Formula = "'" + $value }
        else { $summary.Range('I20').Value2 = [double]$value }
        $excel.CalculateFull()
        $input = $summary.Range('I20')
        $summary.Activate()
        Assert-Equal $input.Text.Replace(',', '.') $inputLabel 'Summary percentage'
        Assert-Equal $graph.Range('D14').Text.Replace(',', '.') $graphLabel 'Graph percentage'
        if ($indicator -is [double]) {
            Assert-Equal $graph.Range('E14').Value2 ([double]$indicator) 'Graph indicator'
        } else {
            Assert-Equal ([string]$graph.Range('E14').Value2) '' 'Hidden graph indicator'
        }
        Assert-Equal $summary.Range('I12').Value2 $warning 'Completion mismatch total'
        Assert-Equal $summary.Range('R20').Text $bin 'Summary readiness category'
        if ($null -ne $value) { Assert-Equal $input.Value2 $value 'Original input value' }
    }

    Assert-Progress 0.0 '0%' '0% · сверить' 0.0 1 '0%'
    Assert-Progress 0.35 '35%' '35% · сверить' 0.35 1 'Больше 0%, меньше 50%'
    Assert-Progress 0.999 '99.9%' '99.9% · сверить' 0.999 1 '50% и выше, меньше 100%'
    Assert-Progress 0.99999 '<100%' '<100% · сверить' 0.99999 1 '50% и выше, меньше 100%'
    Assert-Progress 0.999999999999999 '<100%' '<100% · сверить' 0.999999999999999 1 '50% и выше, меньше 100%'
    Assert-Progress 1.0 '100%' '100%' 1.0 0 '100%'
    Assert-Progress $null '' 'Нет данных' '' 0 'Нет данных'
    Assert-Progress 'ошибка' 'ошибка' 'сверить ввод' '' 0 'Вне диапазона'
    Assert-Progress 1.1 '110%' '110% · сверить' '' 0 'Вне диапазона'
    Assert-Progress 1.00001 '>100%' '>100% · сверить' '' 0 'Вне диапазона'
    Assert-Progress 0.99999 '<100%' '<100% · сверить' 0.99999 1 '50% и выше, меньше 100%'
    $summary.Range('F20').ClearContents()

    $scratch = Join-Path ([IO.Path]::GetDirectoryName($path)) 'vg01-d01-excel-reopen.xlsx'
    $book.SaveCopyAs($scratch)
    $book.Close($false)
    $book = $excel.Workbooks.Open($scratch, 0, $true)
    $excel.CalculateFull()
    $graph = $book.Worksheets.Item('График')
    $summary = $book.Worksheets.Item('Сводка')
    Assert-Equal $graph.Range('D14').Text '<100% · сверить' 'Fraction after reopening'
    Assert-Equal $summary.Range('I20').Value2 0.99999 'Input after reopening'
    $summary.Activate()
    Assert-Equal $summary.Range('I20').Text '<100%' 'Summary display after reopening'
    Assert-Equal $graph.Range('F14').Text 'С опозданием +2 дн.' 'End-only delay after reopening'
    Assert-Equal $summary.Range('C12').Value2 1 'Late total after reopening'
    $book.Close($false)
    Assert-Equal (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash $hash 'Intact source XLSX'
    "Excel $($excel.Version) build $($excel.Build); fractional readiness and reopen: PASS"
    "Original XLSX SHA-256: $hash"
} finally {
    if ($book) { try { $book.Close($false) } catch {} }
    try { $excel.Quit() } catch {}
}

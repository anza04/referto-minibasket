# Divide il referto originale (.xls) in un modello .xlsx per ciascun foglio (richiede Microsoft Excel).
# Poi eseguire:  python tools/build_templates.py
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
New-Item -ItemType Directory -Force "$here\templates" | Out-Null
$map = @{ "REF. 5C5"="5c5"; "REF.4C4 "="4c4"; "REF.4C4 OPEN"="4c4open"; "REF.3C3 SPRINT"="3c3sprint"; "REF.4C4 SPRINT "="4c4sprint";
          "REF. 5C5 Intestazione"="5c5_int"; "REF. 4C4 Intestazione"="4c4_int"; "REF. 4C4 OPEN Intestazione"="4c4open_int";
          "REF.3C3 SPRINT Intestazione"="3c3sprint_int"; "REF.4C4 SPRINT Intestazione "="4c4sprint_int" }
$x = New-Object -ComObject Excel.Application; $x.DisplayAlerts = $false; $x.Visible = $false
$wb = $x.Workbooks.Open("$here\referto-originale.xls")
foreach ($ws in $wb.Worksheets) {
  $key = $map[$ws.Name]
  if (-not $key) { Write-Warning "Foglio non riconosciuto: [$($ws.Name)]"; continue }
  $ws.Copy()
  $nb = $x.ActiveWorkbook
  $nb.SaveAs("$here\templates\$key.xlsx", 51)
  $nb.Close($false)
  Write-Output "$key.xlsx"
}
$wb.Close($false); $x.Quit()

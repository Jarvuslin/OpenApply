$ErrorActionPreference = 'Stop'
$mvpRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$mvpLogs = Join-Path $mvpRoot '.temp/mvp'
foreach ($name in @('web','api','terminal')) {
  $record = Join-Path $mvpLogs "$name.process.json"
  if (!(Test-Path -LiteralPath $record)) { continue }
  $saved = Get-Content -LiteralPath $record -Raw | ConvertFrom-Json
  $process = Get-Process -Id $saved.pid -ErrorAction SilentlyContinue
  if ($process -and $process.StartTime.ToUniversalTime().Ticks -eq ([datetime]$saved.started).ToUniversalTime().Ticks) {
    & taskkill /PID $process.Id /T /F | Out-Null
  }
}
& wsl --terminate OpenApply-MVP
Write-Output 'MVP processes stopped. Database, resumes and browser profile are retained.'

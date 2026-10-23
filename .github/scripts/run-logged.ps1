# Runs a PowerShell command in a child process, keeps its output in a log, and on failure
# publishes the last lines as an ::error:: annotation, since step logs need a GitHub sign-in.
param([Parameter(Mandatory)] [string]$Command, [string]$Log = 'install.log')
# Stop would turn the first stderr line of a native command into a terminating error in 5.1.
$ErrorActionPreference = 'Continue'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$Command; exit `$LASTEXITCODE" *>&1 |
  ForEach-Object { "$_" } | Tee-Object -FilePath $Log
$code = $LASTEXITCODE
if ($code -ne 0) {
  $tail = (Get-Content $Log -Tail 25 | Where-Object { $_.Trim() }) -join '%0A'
  Write-Host "::error title=Installer output (exit $code)::$tail"
  $steps = (Get-Content $Log | Where-Object { $_ -match '^(==>|Installing |\S.*: installed|.*still missing|Successfully installed|Found an existing)' }) -join '%0A'
  Write-Host "::error title=Installer steps::$steps"
}
exit $code

param([switch]$VmOnly, [switch]$Dev)
$ErrorActionPreference = 'Stop'
$mvpRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$mvpBun = (Get-Command bun -ErrorAction Stop).Source
$mvpDotnet = (Get-Command dotnet -ErrorAction Stop).Source
$env:DOTNET_ROOT = Split-Path $mvpDotnet
$env:PATH = (Split-Path $mvpBun) + ';' + (Split-Path $mvpDotnet) + ';' + $env:PATH
$mvpLogs = Join-Path $mvpRoot '.temp/mvp'
New-Item -ItemType Directory -Path $mvpLogs -Force | Out-Null
function Test-MvpEndpoint([string]$Url) {
  try { $null = Invoke-WebRequest $Url -UseBasicParsing -TimeoutSec 2; return $true } catch { return $false }
}
function Start-MvpProcess([string]$Name, [string]$Exe, [string[]]$Arguments, [string]$Directory) {
  $process = Start-Process -FilePath $Exe -ArgumentList $Arguments -WorkingDirectory $Directory -WindowStyle Hidden -RedirectStandardOutput (Join-Path $mvpLogs "$Name.out.log") -RedirectStandardError (Join-Path $mvpLogs "$Name.err.log") -PassThru
  @{ pid = $process.Id; started = $process.StartTime.ToUniversalTime().ToString('o'); name = $Name } | ConvertTo-Json | Set-Content (Join-Path $mvpLogs "$Name.process.json")
}
if (!(Test-MvpEndpoint 'http://127.0.0.1:9222/json/version')) {
  $windowsScript = (Join-Path $PSScriptRoot 'mvp-vm-start.sh').Replace('\','/')
  $vmScript = (& wsl -d OpenApply-MVP -- wslpath -a $windowsScript).Trim()
  Start-MvpProcess 'vm' 'wsl.exe' @('-d','OpenApply-MVP','--','sh',('"' + $vmScript + '"')) $mvpRoot
  for ($attempt = 0; $attempt -lt 120; $attempt++) {
    if (Test-MvpEndpoint 'http://127.0.0.1:9222/json/version') { break }
    Start-Sleep -Milliseconds 500
  }
  if (!(Test-MvpEndpoint 'http://127.0.0.1:9222/json/version')) { throw "VM browser did not start. See $mvpLogs/vm.err.log" }
}
if ($VmOnly) { Write-Output 'OpenApply VM is ready. Database :5433; browser :9222; viewer :6080.'; return }
if (!(Test-MvpEndpoint 'http://127.0.0.1:4101/api/health')) { Start-MvpProcess 'api' $mvpBun @('run','src/app.ts') (Join-Path $mvpRoot 'apps/api') }
if (!(Test-MvpEndpoint 'http://127.0.0.1:4100')) {
  $previousWebOutput = $env:OPENAPPLY_WEB_DIST_DIR
  try {
    if ($Dev) {
      $env:OPENAPPLY_WEB_DIST_DIR = $null
      Start-MvpProcess 'web' $mvpBun @('run','dev','--hostname','127.0.0.1') (Join-Path $mvpRoot 'apps/web')
    } else {
      $env:OPENAPPLY_WEB_DIST_DIR = '.next-preview'
      Write-Output 'Building the web app once for fast navigation. Use -Dev for hot reload.'
      Push-Location $mvpRoot
      try {
        & $mvpBun run build:web
        if ($LASTEXITCODE -ne 0) { throw 'Web build failed; the web server was not started.' }
      } finally { Pop-Location }
      Start-MvpProcess 'web' $mvpBun @('run','start','--hostname','127.0.0.1') (Join-Path $mvpRoot 'apps/web')
    }
  } finally { $env:OPENAPPLY_WEB_DIST_DIR = $previousWebOutput }
}
if (!(Test-MvpEndpoint 'http://127.0.0.1:4102/healthz')) { Start-MvpProcess 'terminal' $mvpDotnet @('run','--project','apps/terminal','--no-build') $mvpRoot }
Write-Output 'OpenApply starting: http://localhost:4100/mvp'
Write-Output 'VM viewer: http://localhost:6080/vnc.html?autoconnect=1'
Write-Output "Logs: $mvpLogs"

# OpenApply installer for Windows x64. On a new machine, in PowerShell:
#   irm https://raw.githubusercontent.com/Jarvuslin/OpenApply/main/scripts/install.ps1 | iex
# That installs Git, clones into %USERPROFILE%\OpenApply (or $env:OPENAPPLY_DIR) and continues there.
# In a checkout: powershell -ExecutionPolicy Bypass -File scripts\install.ps1
# Safe to run again: installed tools are skipped, and it stops whenever you need to act.
# -SkipVm installs only the host tools, for machines that cannot run WSL2 (such as Windows Sandbox).
# A piped run takes options from OPENAPPLY_SKIP_VM=1, OPENAPPLY_NO_START=1 and OPENAPPLY_BRANCH.
param([string]$AlpineVersion = '3.24.3', [switch]$NoStart, [switch]$SkipVm, [string]$InstallDir)
$ErrorActionPreference = 'Stop'
if ($env:OPENAPPLY_SKIP_VM -eq '1') { $SkipVm = $true }
if ($env:OPENAPPLY_NO_START -eq '1') { $NoStart = $true }
# Windows PowerShell 5.1 redraws a progress bar per chunk, which slows downloads many times over.
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

function Step([string]$Text) { Write-Host "`n==> $Text" -ForegroundColor Cyan }
function Stop-ForUser([string]$Text) {
  Write-Host "`n$Text" -ForegroundColor Yellow
  Write-Host 'Then run scripts\install.ps1 again. It continues where it stopped.'
  exit 2
}
function Update-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
  $localBin = Join-Path $env:USERPROFILE '.local\bin'
  if ((Test-Path $localBin) -and ($env:Path -notlike "*$localBin*")) { $env:Path = "$localBin;$env:Path" }
}
function Test-Command([string]$Name) { [bool](Get-Command $Name -ErrorAction SilentlyContinue) }
function Install-Winget([string]$Id, [string]$Label) {
  Write-Host "Installing $Label..."
  & winget install --id $Id --exact --source winget --silent --accept-source-agreements --accept-package-agreements
  if ($LASTEXITCODE -ne 0) { throw "winget could not install $Label ($Id)." }
  Update-Path
}
function Test-DotnetSdk {
  # Any dotnet with a 10.x SDK counts, whatever its place on PATH.
  & node (Join-Path $PSScriptRoot 'dotnet.mjs') --print-path *> $null
  return $LASTEXITCODE -eq 0
}
function Get-AlpineRootfs([string]$Version, [string]$Directory) {
  $minor = ($Version.Split('.')[0..1]) -join '.'
  $file = "alpine-minirootfs-$Version-x86_64.tar.gz"
  $url = "https://dl-cdn.alpinelinux.org/alpine/v$minor/releases/x86_64/$file"
  New-Item -ItemType Directory -Force $Directory | Out-Null
  $rootfs = Join-Path $Directory $file
  if (!(Test-Path $rootfs)) {
    Write-Host "Downloading $url"
    Invoke-WebRequest $url -OutFile $rootfs -UseBasicParsing
  }
  # Saved to a file because 5.1 returns an octet-stream body as bytes, not text.
  $sumFile = "$rootfs.sha256"
  Invoke-WebRequest "$url.sha256" -OutFile $sumFile -UseBasicParsing
  $expected = ((Get-Content $sumFile -Raw).Trim() -split '\s+')[0].ToLower()
  $actual = (Get-FileHash $rootfs -Algorithm SHA256).Hash.ToLower()
  if ($expected -ne $actual) {
    Remove-Item $rootfs, $sumFile
    throw "Checksum mismatch for $file. The download was removed; run the installer again."
  }
  Write-Host "Alpine $Version checksum verified."
  return $rootfs
}

if ([Environment]::Is64BitOperatingSystem -eq $false -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64') {
  throw 'OpenApply supports Windows x64 only.'
}
if (!(Test-Command winget)) { throw 'winget is missing. Install "App Installer" from the Microsoft Store, then run this again.' }
Update-Path

if (!$PSScriptRoot -or !(Test-Path (Join-Path $PSScriptRoot 'openapply.mjs'))) {
  # Piped through iex: get Git and the code, then run the checkout's own copy of this script.
  # Exiting here would close the user's PowerShell window, so this part only returns or throws.
  if (!$InstallDir) { $InstallDir = $env:OPENAPPLY_DIR }
  if (!$InstallDir) { $InstallDir = Join-Path $env:USERPROFILE 'OpenApply' }
  $repo = $env:OPENAPPLY_REPO
  if (!$repo) { $repo = 'https://github.com/Jarvuslin/OpenApply.git' }
  $branch = $env:OPENAPPLY_BRANCH
  if (!$branch) { $branch = 'main' }
  Step 'Getting the OpenApply code'
  if (Test-Command git) { Write-Host 'Git: installed' } else { Install-Winget 'Git.Git' 'Git' }
  if (Test-Path (Join-Path $InstallDir '.git')) {
    Write-Host "Updating $InstallDir"
    & git -C $InstallDir fetch origin $branch
    & git -C $InstallDir checkout $branch
    & git -C $InstallDir pull --ff-only origin $branch
    if ($LASTEXITCODE -ne 0) { Write-Host 'Could not fast-forward; continuing with the code already there.' -ForegroundColor Yellow }
  } elseif ((Test-Path $InstallDir) -and (Get-ChildItem $InstallDir -Force | Select-Object -First 1)) {
    throw "$InstallDir exists and is not an OpenApply checkout. Set OPENAPPLY_DIR to another folder."
  } else {
    & git clone --branch $branch $repo $InstallDir
    if ($LASTEXITCODE -ne 0) { throw "git clone of $repo failed." }
  }
  $forward = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $InstallDir 'scripts\install.ps1'), '-AlpineVersion', $AlpineVersion)
  if ($SkipVm) { $forward += '-SkipVm' }
  if ($NoStart) { $forward += '-NoStart' }
  & powershell.exe @forward
  if ($LASTEXITCODE -ne 0) { Write-Host "The installer stopped (exit $LASTEXITCODE). Run it again after the step above." -ForegroundColor Yellow }
  return
}
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Step 'Developer tools'
if (Test-Command git) { Write-Host 'Git: installed' } else { Install-Winget 'Git.Git' 'Git' }
$nodeMajor = 0
if (Test-Command node) { $nodeMajor = [int]((& node --version).TrimStart('v').Split('.')[0]) }
if ($nodeMajor -ge 22) { Write-Host "Node.js: v$nodeMajor" } else { Install-Winget 'OpenJS.NodeJS.LTS' 'Node.js LTS' }
if (Test-Command bun) { Write-Host 'Bun: installed' } else { Install-Winget 'Oven-sh.Bun' 'Bun' }
if (Test-DotnetSdk) { Write-Host '.NET 10 SDK: installed' } else { Install-Winget 'Microsoft.DotNet.SDK.10' '.NET 10 SDK' }

Step 'WSL2'
if ($SkipVm) {
  Write-Host 'Skipped (-SkipVm).'
} else {
  & wsl.exe --status *> $null
  if ($LASTEXITCODE -ne 0) {
    $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (!$admin) { Stop-ForUser 'WSL2 is not enabled. Open PowerShell as administrator and run: wsl --install --no-distribution' }
    & wsl.exe --install --no-distribution
    Stop-ForUser 'WSL2 was enabled. Restart Windows to finish it.'
  }
  Write-Host 'WSL2: enabled'
}

Step 'Claude Code'
if (!(Test-Command claude)) {
  # Anthropic's official native installer.
  Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression
  Update-Path
  if (!(Test-Command claude)) { Stop-ForUser 'Claude Code installed but is not on PATH yet. Open a new PowerShell window.' }
}
$auth = $null
try { $auth = (& claude auth status 2>$null) | Out-String | ConvertFrom-Json } catch { }
if ($auth -and -not $auth.loggedIn -and -not $SkipVm) { Stop-ForUser 'Sign in to Claude Code: run claude auth login and finish in the browser.' }
if (!$auth) { Write-Host 'Could not read sign-in status. Run claude once and sign in if asked.' }
elseif ($auth.loggedIn) { Write-Host 'Claude Code: signed in' }
else { Write-Host 'Claude Code: not signed in (run claude auth login later).' }

Step 'Project dependencies'
& bun install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw 'bun install failed.' }

$downloads = Join-Path $root '.temp\install'
if ($SkipVm) {
  Step 'Host-only setup (-SkipVm)'
  [void](Get-AlpineRootfs $AlpineVersion $downloads)
  & node scripts/openapply.mjs env
  if ($LASTEXITCODE -ne 0) { throw 'Creating the .env files failed.' }
  & bun --cwd=apps/api run db:generate
  if ($LASTEXITCODE -ne 0) { throw 'Prisma generate failed.' }
  & node scripts/dotnet.mjs build apps/terminal
  if ($LASTEXITCODE -ne 0) { throw 'Building the terminal failed.' }
  Step 'Doctor'
  & node scripts/openapply.mjs doctor
  Write-Host "`nHost tools installed. The VM, database and start were skipped (-SkipVm)."
  exit 0
}

Step 'Browser and database VM'
$setupArgs = @('scripts/openapply.mjs', 'setup')
$distros = (& wsl.exe --list --quiet) -replace "`0", ''
if ($distros -contains 'OpenApply-MVP') {
  Write-Host 'WSL distribution OpenApply-MVP: present'
} else {
  $setupArgs += @('--rootfs', (Get-AlpineRootfs $AlpineVersion $downloads))
}

Step 'OpenApply setup'
& node @setupArgs
if ($LASTEXITCODE -ne 0) { throw 'Setup failed. Fix the error above and run the installer again.' }

Step 'Doctor'
& node scripts/openapply.mjs doctor
if ($LASTEXITCODE -ne 0) { Stop-ForUser 'Doctor found a required check that failed. Follow the Fix line above.' }

if ($NoStart) { Write-Host "`nInstalled. Start with: node scripts/openapply.mjs start"; exit 0 }
Step 'Starting OpenApply'
& node scripts/openapply.mjs start --open

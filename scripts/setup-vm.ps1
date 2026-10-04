param(
  [Parameter(Mandatory = $true)][string]$RootfsPath,
  [string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA 'OpenApply/vm')
)
$ErrorActionPreference = 'Stop'
$rootfs = (Resolve-Path -LiteralPath $RootfsPath).Path
$distros = (& wsl --list --quiet) -replace "`0", ''
if ($distros | Where-Object { $_.Trim() -eq 'JobPilot-MVP' }) {
  throw 'JobPilot-MVP already exists. No existing VM was modified.'
}
New-Item -ItemType Directory -Path $InstallDirectory -Force | Out-Null
& wsl --import JobPilot-MVP $InstallDirectory $rootfs --version 2
if ($LASTEXITCODE -ne 0) { throw 'WSL import failed.' }
& wsl -d JobPilot-MVP -- sh -c "sed -i '/\/community/s/^#//' /etc/apk/repositories"
if ($LASTEXITCODE -ne 0) { throw 'Could not enable the Alpine community repository.' }
& wsl -d JobPilot-MVP -- apk add --no-cache bash nodejs npm chromium xvfb x11vnc novnc websockify postgresql18 postgresql18-client font-noto
if ($LASTEXITCODE -ne 0) { throw 'Alpine packages failed to install. Check networking and repositories.' }
Write-Output 'OpenApply VM provisioned. Follow the README to start services and migrate the database.'

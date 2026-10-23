# Makes a Windows runner look like a new machine for Git, Node and .NET, so the installer
# really installs them: uninstall what Windows knows about, move the rest aside, prune PATH.
$ErrorActionPreference = 'Stop'
$binaries = 'git.exe', 'node.exe', 'dotnet.exe'

function Remove-Installed([string]$Pattern) {
  $keys = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  foreach ($entry in Get-ItemProperty $keys -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match $Pattern }) {
    Write-Host "Uninstalling $($entry.DisplayName)"
    if ($entry.PSChildName -match '^\{[0-9A-F-]+\}$') {
      Start-Process msiexec.exe -ArgumentList '/x', $entry.PSChildName, '/qn', '/norestart' -Wait
    } elseif ($entry.QuietUninstallString) {
      Start-Process cmd.exe -ArgumentList '/c', $entry.QuietUninstallString -Wait
    } elseif ($entry.UninstallString) {
      Start-Process cmd.exe -ArgumentList '/c', "$($entry.UninstallString) /VERYSILENT /SUPPRESSMSGBOXES /NORESTART" -Wait
    }
  }
}

Remove-Installed '^Git( version [0-9.]+)?$'
Remove-Installed '^Node\.js'
Remove-Installed '^Microsoft \.NET SDK 10\.'

$folders = @("$env:ProgramFiles\Git", "$env:ProgramFiles\nodejs", "$env:ProgramFiles\dotnet",
  "$env:USERPROFILE\.dotnet", "$env:LOCALAPPDATA\Microsoft\dotnet")
foreach ($folder in $folders) {
  if (Test-Path $folder) {
    Write-Host "Moving aside $folder"
    Rename-Item $folder ((Split-Path $folder -Leaf) + '.hidden')
  }
}

function Test-HasBinary([string]$Directory) {
  foreach ($binary in $binaries) { if (Test-Path (Join-Path $Directory $binary)) { return $true } }
  return $false
}
foreach ($scope in 'Machine', 'User') {
  $entries = ([Environment]::GetEnvironmentVariable('Path', $scope) -split ';') | Where-Object { $_ }
  $kept = $entries | Where-Object { -not (Test-HasBinary $_) }
  foreach ($dropped in $entries | Where-Object { $kept -notcontains $_ }) { Write-Host "Removing from $scope PATH: $dropped" }
  [Environment]::SetEnvironmentVariable('Path', ($kept -join ';'), $scope)
}

$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
$left = foreach ($name in 'git', 'node', 'dotnet') { Get-Command $name -ErrorAction SilentlyContinue }
if ($left) { $left | ForEach-Object { Write-Host "Still found: $($_.Source)" }; throw 'Tools are still on PATH.' }
foreach ($id in 'Git.Git', 'OpenJS.NodeJS.LTS', 'Microsoft.DotNet.SDK.10') {
  & winget list --id $id --exact --accept-source-agreements --disable-interactivity *> $null
  if ($LASTEXITCODE -eq 0) { throw "winget still lists $id." }
}
Write-Host 'Git, Node and .NET are hidden.'

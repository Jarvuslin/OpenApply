# Makes a Windows runner look like a new machine for Git, Node and .NET, so the installer
# really installs them: uninstall what Windows knows about, move the rest aside, prune PATH.
$ErrorActionPreference = 'Stop'
# Step logs need a GitHub sign-in; ::error:: and ::notice:: lines show as public annotations.
trap { Write-Host "::error::hide-tools.ps1 line $($_.InvocationInfo.ScriptLineNumber): $($_.Exception.Message)"; exit 1 }
$binaries = 'git.exe', 'node.exe', 'dotnet.exe'
$removed = @()

function Remove-Installed([string]$Pattern) {
  $keys = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  foreach ($entry in Get-ItemProperty $keys -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match $Pattern }) {
    Write-Host "Uninstalling $($entry.DisplayName)"
    $script:removed += $entry.DisplayName
    # Bundles (the .NET SDK) also have a GUID key, but only their own uninstaller removes them.
    if ($entry.QuietUninstallString) {
      Start-Process cmd.exe -ArgumentList '/c', $entry.QuietUninstallString -Wait
    } elseif ($entry.WindowsInstaller -eq 1) {
      Start-Process msiexec.exe -ArgumentList '/x', $entry.PSChildName, '/qn', '/norestart' -Wait
    } elseif ($entry.UninstallString) {
      Start-Process cmd.exe -ArgumentList '/c', "$($entry.UninstallString) /VERYSILENT /SUPPRESSMSGBOXES /NORESTART" -Wait
    }
  }
}

Remove-Installed '^Git( version [0-9.]+)?$'
Remove-Installed '^Node\.js'
Remove-Installed '^Microsoft \.NET SDK 10\.'

# Visual Studio registers the SDK's MSI packages too. While any stay registered, a winget
# install of the same version is a no-op and leaves no files, so remove each one directly.
$msiKeys = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
function Get-SdkPackages {
  Get-ItemProperty $msiKeys -ErrorAction SilentlyContinue |
    Where-Object { $_.WindowsInstaller -eq 1 -and $_.DisplayName -match '\.NET.*SDK.*10\.0' }
}
foreach ($package in Get-SdkPackages) {
  Write-Host "msiexec /x $($package.DisplayName)"
  $removed += "msi $($package.DisplayName)"
  Start-Process msiexec.exe -ArgumentList '/x', $package.PSChildName, '/qn', '/norestart', 'IGNOREDEPENDENCIES=ALL' -Wait
}
$stuck = @(Get-SdkPackages)
if ($stuck) { throw "Still registered: $(($stuck | ForEach-Object DisplayName) -join ', ')" }

$folders = @("$env:ProgramFiles\Git", "$env:ProgramFiles\nodejs", "$env:ProgramFiles\dotnet",
  "$env:USERPROFILE\.dotnet", "$env:LOCALAPPDATA\Microsoft\dotnet")
foreach ($folder in $folders) {
  if (Test-Path $folder) {
    Write-Host "Moving aside $folder"
    $removed += "folder $folder"
    Rename-Item $folder ((Split-Path $folder -Leaf) + '.hidden')
  }
}

function Test-HasBinary([string]$Directory) {
  foreach ($binary in $binaries) {
    if (Test-Path -LiteralPath (Join-Path $Directory $binary) -ErrorAction SilentlyContinue) { return $true }
  }
  return $false
}
foreach ($scope in 'Machine', 'User') {
  $entries = ([Environment]::GetEnvironmentVariable('Path', $scope) -split ';') | Where-Object { $_ }
  $kept = @($entries | Where-Object { -not (Test-HasBinary $_) })
  foreach ($dropped in $entries | Where-Object { $kept -notcontains $_ }) {
    Write-Host "Removing from $scope PATH: $dropped"
    $removed += "PATH $dropped"
  }
  [Environment]::SetEnvironmentVariable('Path', ($kept -join ';'), $scope)
}

$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
$left = foreach ($name in 'git', 'node', 'dotnet') { Get-Command $name -ErrorAction SilentlyContinue }
if ($left) { throw "Still on PATH: $(($left | ForEach-Object Source) -join ', ')" }
foreach ($id in 'Git.Git', 'OpenJS.NodeJS.LTS', 'Microsoft.DotNet.SDK.10') {
  & winget list --id $id --exact --accept-source-agreements --disable-interactivity *> $null
  if ($LASTEXITCODE -ne 0) { continue }
  Write-Host "winget uninstall $id"
  & winget uninstall --id $id --exact --silent --accept-source-agreements --disable-interactivity
  & winget list --id $id --exact --accept-source-agreements --disable-interactivity *> $null
  if ($LASTEXITCODE -eq 0) { throw "winget still lists $id after uninstalling it." }
}
Write-Host "::notice title=Hidden before install::$($removed -join '; ')"
# winget list sets a nonzero exit code when nothing is found, and the runner would report it.
exit 0

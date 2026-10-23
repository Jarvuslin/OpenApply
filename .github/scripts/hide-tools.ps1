# Makes a Windows runner look like a new machine for Git, Node and .NET, so the installer
# really installs them: uninstall what Windows knows about, move the rest aside, prune PATH.
$ErrorActionPreference = 'Stop'
# Step logs need a GitHub sign-in; ::error:: and ::notice:: lines show as public annotations.
trap { Write-Host "::error::hide-tools.ps1 line $($_.InvocationInfo.ScriptLineNumber): $($_.Exception.Message)"; exit 1 }
$removed = @()
$uninstallKeys = @(
  'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
)

# A .NET 10 SDK registered by Visual Studio cannot be unregistered, and winget's install of the
# same version is then a no-op that leaves no files. On such an image .NET stays in place and is
# reported as found; Git, Node and Bun are still removed and must be installed fresh. The fresh
# winget install of .NET on Windows passed in run 39904121796, on an image without that SDK:
# https://github.com/Jarvuslin/OpenApply/actions/runs/39904121796
$visualStudioSdk = Get-ItemProperty $uninstallKeys -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -match '\.NET SDK 10\..*from Visual Studio' } | Select-Object -First 1
$keepDotnet = [bool]$visualStudioSdk
$binaries = @('git.exe', 'node.exe')
$hidden = @('git', 'node')
$ids = @('Git.Git', 'OpenJS.NodeJS.LTS')
$folders = @("$env:ProgramFiles\Git", "$env:ProgramFiles\nodejs")
if ($keepDotnet) {
  Write-Host "::warning title=.NET kept::$($visualStudioSdk.DisplayName) cannot be unregistered on this runner, so .NET stays in place and counts as found."
  Add-Content $env:GITHUB_ENV 'OPENAPPLY_DOTNET_KEPT=1'
} else {
  $binaries += 'dotnet.exe'
  $hidden += 'dotnet'
  $ids += 'Microsoft.DotNet.SDK.10'
  $folders += "$env:ProgramFiles\dotnet", "$env:USERPROFILE\.dotnet", "$env:LOCALAPPDATA\Microsoft\dotnet"
}

function Remove-Installed([string]$Pattern) {
  foreach ($entry in Get-ItemProperty $uninstallKeys -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match $Pattern }) {
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
if (!$keepDotnet) { Remove-Installed '^Microsoft \.NET SDK 10\.' }

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
$left = foreach ($name in $hidden) { Get-Command $name -ErrorAction SilentlyContinue }
if ($left) { throw "Still on PATH: $(($left | ForEach-Object Source) -join ', ')" }
foreach ($id in $ids) {
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

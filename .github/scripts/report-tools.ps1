# Prints which tools a fresh PowerShell would find. With -ExpectWinget, also fails unless
# winget installed Git, Node and the .NET 10 SDK and they resolve.
# Step logs need a GitHub sign-in, so the summary also goes out as a public ::notice:: annotation.
param([string]$Title, [string]$Repo = '.', [switch]$ExpectWinget)
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') + ";$env:USERPROFILE\.local\bin"
Write-Host "== $Title"
$summary = @()
foreach ($name in 'git', 'node', 'bun', 'dotnet', 'claude') {
  $command = Get-Command $name -ErrorAction SilentlyContinue
  if ($command) {
    $version = (& $command.Source --version 2>$null | Select-Object -First 1)
    Write-Host ("{0,-7} {1}  ({2})" -f $name, $version, $command.Source)
    $summary += "$name $version"
  } else {
    Write-Host ("{0,-7} missing" -f $name)
    $summary += "$name missing"
  }
}
Write-Host "::notice title=$Title::$($summary -join '; ')"
if (!$ExpectWinget) { exit 0 }

$failed = @()
$ids = @('Git.Git', 'OpenJS.NodeJS.LTS', 'Oven-sh.Bun')
# hide-tools.ps1 sets this when the runner's Visual Studio .NET SDK could not be removed (see there).
if ($env:OPENAPPLY_DOTNET_KEPT -eq '1') {
  Write-Host ".NET 10 SDK: found (runner's Visual Studio copy)"
  Add-Content $env:GITHUB_STEP_SUMMARY "- .NET 10 SDK: found (runner's Visual Studio copy); fresh install proven in run 39904121796"
} else {
  $ids += 'Microsoft.DotNet.SDK.10'
}
foreach ($id in $ids) {
  & winget list --id $id --exact --accept-source-agreements --disable-interactivity *> $null
  if ($LASTEXITCODE -eq 0) {
    Write-Host "winget installed $id"
    Add-Content $env:GITHUB_STEP_SUMMARY "- $id`: installed by winget"
  } else {
    $failed += "$id not installed by winget"
  }
}
if (!(Get-Command git -ErrorAction SilentlyContinue)) { $failed += 'git does not resolve' }
$nodeMajor = 0
if (Get-Command node -ErrorAction SilentlyContinue) { $nodeMajor = [int]((& node --version).TrimStart('v').Split('.')[0]) }
if ($nodeMajor -lt 22) { $failed += "node 22+ does not resolve (major $nodeMajor)" }
$dotnet = & node (Join-Path $Repo 'scripts/dotnet.mjs') --print-path 2>$null
if ($LASTEXITCODE -ne 0) { $failed += 'no dotnet with a 10.x SDK' } else { Write-Host "OpenApply uses $dotnet" }
if ($failed) { Write-Host "::error title=$Title::$($failed -join '; ')"; exit 1 }
Write-Host 'Git, Node 22+, Bun and a working .NET 10 SDK are in place.'
exit 0

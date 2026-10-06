$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$apiEnv = Join-Path $projectRoot 'apps/api/.env'
$webEnv = Join-Path $projectRoot 'apps/web/.env.local'
if (!(Test-Path -LiteralPath $apiEnv)) {
  $jwtBytes = New-Object byte[] 32
  $masterBytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($jwtBytes); $rng.GetBytes($masterBytes) } finally { $rng.Dispose() }
  $jwt = ([BitConverter]::ToString($jwtBytes)).Replace('-', '').ToLowerInvariant()
  $master = [Convert]::ToBase64String($masterBytes)
  $template = Get-Content -LiteralPath (Join-Path $projectRoot 'apps/api/.env.example') -Raw
  $template = $template.Replace('JWT_SECRET=dev-insecure-change-me', "JWT_SECRET=$jwt")
  $template = $template.Replace('SECRET_MASTER_KEY=', "SECRET_MASTER_KEY=$master")
  # Keep sign-in placeholders visible while omitting other unset optional values.
  $template = [regex]::Replace($template, '(?m)^(?!(?:GOOGLE|GITHUB)_CLIENT_(?:ID|SECRET)=)[A-Z_]+=\r?\n', '')
  $template += "`nMVP_LOCAL_RUNNER=true`nCLAUDE_BIN=claude`n"
  [IO.File]::WriteAllText($apiEnv, $template, [Text.UTF8Encoding]::new($false))
  Write-Output 'Created apps/api/.env with new local encryption and session keys.'
} else { Write-Output 'Kept existing apps/api/.env.' }
if (!(Test-Path -LiteralPath $webEnv)) {
  Copy-Item -LiteralPath (Join-Path $projectRoot 'apps/web/.env.example') -Destination $webEnv
  Write-Output 'Created apps/web/.env.local.'
} else { Write-Output 'Kept existing apps/web/.env.local.' }

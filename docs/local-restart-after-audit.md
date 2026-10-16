# Activate the audited local fixes

**Historical activation completed:** the user ran this handoff successfully on October 7 at about
14:25 Toronto time. The commands/helper below are pinned to the old process identities and must
not be reused unchanged. Post-trial fixes require a fresh process/idle audit before another activation.
See `rewrite-v2-validation-2026-10-07.md` for the completed previews and source-only follow-up fixes.

Automatic approval review rejected the assistant's service restart with the reason **"blocked by policy"**. No service was stopped by that rejected action. The assistant has not executed a restart or a workaround. The steps below are for the user to run in a local PowerShell terminal.

The completed source changes include the canonical LaTeX renderer, validation of the actual one-page PDF, immutable PDF/LaTeX revisions with source and job-description evidence, and chat/runtime repairs. They are not active in an API or companion process that loaded the previous code. The existing web development server reloads source changes automatically; it still needs the updated API.

## Configure the existing compiler first

Run from `D:\Dev\OpenApply`. The API accepts an existing executable through `OPENAPPLY_TECTONIC_PATH`, then `tectonic` on `PATH`. The script below also copies an inherited `CODEX_TECTONIC_PATH` into `OPENAPPLY_TECTONIC_PATH`. Keep the inherited compiler/cache/bundle configuration if it already exists. This does not install TeX or change the Codex installation.

```powershell
$ErrorActionPreference = 'Stop'
Set-Location D:\Dev\OpenApply
$env:PATH = 'D:\Dev\tools\bun;D:\Dev\tools\dotnet;' + $env:PATH

$auditTectonic = $env:OPENAPPLY_TECTONIC_PATH
if (!$auditTectonic) { $auditTectonic = $env:CODEX_TECTONIC_PATH }
if (!$auditTectonic) {
    $auditTectonic = (Get-Command tectonic -CommandType Application -ErrorAction SilentlyContinue |
        Select-Object -First 1).Source
}

# Optional discovery of a compiler in an already-installed Codex package.
# No version-specific WindowsApps path is assumed.
if (!$auditTectonic) {
    $auditCandidates = @(Get-AppxPackage -Name OpenAI.Codex -ErrorAction SilentlyContinue |
        ForEach-Object {
            Get-ChildItem -LiteralPath $_.InstallLocation -Filter tectonic.exe -File -Recurse -ErrorAction SilentlyContinue
        } | Select-Object -ExpandProperty FullName -Unique)
    if ($auditCandidates.Count -ne 1) {
        throw 'Set OPENAPPLY_TECTONIC_PATH to the absolute path of your existing Tectonic executable, then rerun this section. No compiler was selected or installed.'
    }
    $auditTectonic = $auditCandidates[0]
}
if (!(Test-Path -LiteralPath $auditTectonic -PathType Leaf)) {
    throw 'The configured compiler is missing. Correct its path before stopping any service.'
}
$env:OPENAPPLY_TECTONIC_PATH = (Resolve-Path -LiteralPath $auditTectonic).Path
$auditCompilerVersion = & $env:OPENAPPLY_TECTONIC_PATH --version
if ($LASTEXITCODE -ne 0 -or ($auditCompilerVersion -join ' ') -notmatch '^Tectonic\s+') {
    throw 'The selected executable did not identify itself as Tectonic. Do not restart yet.'
}
$auditCompilerVersion
```

Leave this terminal open: the API started from it must inherit the environment. The optional `TECTONIC_CACHE_DIR`, `OPENAPPLY_TECTONIC_BUNDLE`, and `OPENAPPLY_TECTONIC_ONLY_CACHED` settings are preserved. A successful `--version` check proves the executable is available; it does not prove the required font/bundle resources can compile a resume. A later compile failure must remain visible, with no replacement template or fabricated success.

## Check the current processes, then activate

The last checked owners were API **43588**, started **2026-10-06 21:44:47 Toronto**, and companion **50756**, started **2026-10-06 21:49:59 Toronto**. These are observations, not permanent process identities. The script checks port ownership and start times again, and refuses to continue if either has changed. It checks that chat, Pilot, and the interactive agent are idle immediately before stopping anything. Finish or stop active work through OpenApply first; keep Pilot off during the preview-only test.

Run the following in the same terminal after configuring the compiler. The tests use a separate output directory while the existing companion is running. The subsequent build is the ordinary local development companion; the native release/AOT build has a separate Visual Studio C++ linker requirement.

```powershell
$auditExpected = @(
    @{ Name = 'API'; Port = 4101; Id = 43588; Started = '2026-10-06 21:44:47' },
    @{ Name = 'Companion'; Port = 4102; Id = 50756; Started = '2026-10-06 21:49:59' }
)
$auditTorontoZone = [TimeZoneInfo]::FindSystemTimeZoneById('Eastern Standard Time')
function Assert-AuditOwners {
    foreach ($auditService in $auditExpected) {
        $auditOwners = @(Get-NetTCPConnection -LocalPort $auditService.Port -State Listen |
            Select-Object -ExpandProperty OwningProcess -Unique)
        if ($auditOwners.Count -ne 1 -or $auditOwners[0] -ne $auditService.Id) {
            throw "$($auditService.Name) owner changed. Recheck the current service instead of reusing an old PID."
        }
        $auditProcess = Get-Process -Id $auditService.Id
        $auditStarted = [TimeZoneInfo]::ConvertTimeFromUtc(
            $auditProcess.StartTime.ToUniversalTime(), $auditTorontoZone).ToString('yyyy-MM-dd HH:mm:ss')
        if ($auditStarted -ne $auditService.Started) {
            throw "$($auditService.Name) start time changed. The PID may have been reused; do not stop it."
        }
        Get-CimInstance Win32_Process -Filter "ProcessId = $($auditService.Id)" |
            Select-Object ProcessId, ExecutablePath, CommandLine
    }
}
function Assert-AuditIdle {
    $auditChat = Invoke-RestMethod http://127.0.0.1:4102/chat/status -TimeoutSec 5
    $auditHealth = Invoke-RestMethod http://127.0.0.1:4102/healthz -TimeoutSec 5
    if ($auditChat.running -ne $false -or $auditHealth.pilot.running -ne $false -or $auditHealth.session -ne 'stopped') {
        throw 'Chat, Pilot or an interactive agent is active, or status is incomplete. Resolve that in OpenApply before restarting.'
    }
}

Assert-AuditOwners
Assert-AuditIdle
dotnet test --artifacts-path D:\Dev\OpenApply\.temp\activation-tests
if ($LASTEXITCODE -ne 0) { throw 'Tests failed; no service has been stopped.' }

# Revalidate after the tests; do not start another chat/Pilot run during activation.
Assert-AuditOwners
Assert-AuditIdle
Stop-Process -Id 43588,50756
dotnet build apps/terminal
if ($LASTEXITCODE -ne 0) { throw 'Companion build failed; do not continue. Read the build error before starting it.' }
& .\scripts\start-mvp.ps1 -Dev
```

Keep the existing database, browser VM and web server. Do not reset, reseed or migrate the database for these renderer/artifact changes. The start script starts missing services with hidden process windows and keeps existing healthy services. The headed VM browser remains visible through [noVNC](http://localhost:6080/vnc.html?autoconnect=1).

Verify the API and companion return healthy responses before retrying chat. A bounded wait is sufficient; stop and inspect `.temp/mvp/api.err.log` and `.temp/mvp/terminal.err.log` if either does not recover.

```powershell
$auditReady = $false
for ($auditAttempt = 0; $auditAttempt -lt 20; $auditAttempt++) {
    try {
        $null = Invoke-RestMethod http://127.0.0.1:4101/api/health -TimeoutSec 2
        $null = Invoke-RestMethod http://127.0.0.1:4102/healthz -TimeoutSec 2
        $auditReady = $true
        break
    } catch { Start-Sleep -Seconds 1 }
}
if (!$auditReady) { throw 'API or companion is not ready. Inspect the startup logs before continuing.' }
Invoke-RestMethod http://127.0.0.1:4102/chat/status -TimeoutSec 5
```

Health checks alone do not prove the resume workflow works. Reopen the authenticated workspace and use **Reconnect computer** if needed. Check that saved conversations/profile data load and the active agent's progress remains visible.

## Resume only the three rewrite previews

Continue the **Nava, Superhuman and Zip** previews through ordinary OpenApply chat. OpenApply's Claude/Codex agent must perform the work. Keep the headed VM viewer and chat progress visible. The outer assistant observes and reports; it does not fill employer forms or replace the agent's resume work. Use the previously selected source resume and saved job descriptions/links; inspect the prior chat before retrying an ambiguous timed-out message.

For each job, ask the agent to score the **original source** against the full JD, create an evidence-backed rewrite in the canonical one-page format, and show the saved OpenApply PDF and changes. A short prompt can say:

> Continue the Nava, Superhuman and Zip resume previews using the selected original resume and saved jobs. Score the original against each complete JD, rewrite only supported content, and show the canonical one-page PDFs and evidence in OpenApply. Preview only; do not apply.

Verify each result has a persisted original-source assessment, a linked variant, an immutable revision with source/JD references and hashes, an actual one-page PDF, its matching LaTeX source, and a readable change/evidence review. Preview, download and any later staging must identify the same revision. Compilation or validation failures are incomplete previews, not successful documents. Existing drafts require **Generate canonical PDF** explicitly; original uploads and historically submitted PDFs remain unchanged.

This continuation authorizes **three previews only**: no employer applications or submissions, account creation, employer uploads, mailbox checks or Gmail OAuth. Keep the existing five-application trial separate until explicitly resumed.

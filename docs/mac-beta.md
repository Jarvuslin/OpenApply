# Mac beta validation

Status: implemented, awaiting a real Mac VM workflow test. Host unit tests and YAML
validation do not establish that the browser VM boots or that employer signup works.
Apple Silicon is the primary beta target; Intel uses the same adapter but requires
its own acceptance run. macOS 14+ and Lima 2+ are required.

## Runtime decision

One app, one agent workflow, two VM adapters: WSL on Windows x64 and Lima/VZ on Mac.
The local terminal reports OS architecture to the web app. The Node launcher also
checks Rosetta translation before choosing the guest architecture. Detection must
run on the host, not inside the Linux VM or a hosted API.

Lima image URLs and SHA-512 digests come from the official
[Alpine 3.23 image template](https://github.com/lima-vm/lima/blob/master/templates/_images/alpine-3.23.yaml).
The VM has no host filesystem mounts. Application files are explicitly copied over
stdin by openapply-stage into /home/pilot/openapply with private permissions.
The same pinned Playwright MCP and Chromium CDP interface serve both platforms.

Trade-off: two VM lifecycle adapters to maintain, in exchange for retaining the
existing Windows runtime and native Mac virtualization. No Electron rewrite or
separate Mac application fork is needed.

## Acceptance checklist — all pending on a real Mac

- Fresh clone: setup selects native architecture, provisions and starts the VM.
- Re-run setup: existing environment secrets, profile and database survive.
- Start: web 4100, API 4101, terminal 4102, database 5433, browser 9222 and viewer 6080.
- Register, save incomplete onboarding, reload, upload a text PDF and a DOCX.
- Claude authenticates normally; extraction and tailoring preserve source facts.
- Review and export the tailored PDF.
- Stage a filename with spaces/non-ASCII; verify bytes and upload to a local fixture.
- Connect the intended Gmail in the app and retrieve a matching test verification message.
- Test signup, activation and sign-in on an explicitly authorized destination.
- Stop and restart; browser cookies, database and encrypted tokens survive.
- Sleep/wake and interrupted VM startup produce recoverable errors.
- An occupied port, absent Lima, missing CLI or blocking CAPTCHA produces a clear pause.
- The app's agent completes the authorized workflow without operator repair.
- Run the checklist separately on Apple Silicon and Intel; record OS/Lima versions.

No employer application is submitted by setup or CI. Real submission still needs
the user's chosen destination and confirmed applicant answers.

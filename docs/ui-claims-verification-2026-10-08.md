# UI review verification — October 8, 2026

The pasted review was checked against the current working tree, including its existing uncommitted changes. Findings below distinguish code defects from design choices. No application, campaign, email, or profile was submitted during verification.

## Numbered claims

| Claim | Verdict | Resolution |
| --- | --- | --- |
| 1. Terminal overlay replaces the dock | Partly confirmed | `AppShell` always passed `compact`, making the docked version unreachable. The drawer used the saved width; it was not necessarily full-screen. Removed the modal branch. The resizable side dock is available through Advanced tools, off by default. Expansion is transient, starts collapsed, and clears when entering Chat, preventing terminal restarts after leaving Chat. |
| 2. Campaign and agent actions force Chat navigation | Confirmed | Removed navigation from agent dispatch. Success and recoverable-error notifications offer **Open conversation**. Campaign creation retains its campaign destination. The old redirect happened when dispatch finished, not when the agent completed its work. |
| 3. Pilot errors remain loading forever | Confirmed | Added explicit loading, error, and retry states in the overview. |
| 4. Mailbox failure appears disconnected | Confirmed | Inbox distinguishes request failure from a confirmed disconnected mailbox and offers Retry. |
| 5. Empty Discover shows an end-of-results footer too | Confirmed | The footer requires a positive result count. Empty and saved-empty copy are distinct. |
| 6. Failed New chat creation locks the form | Confirmed | Added Discard draft while preserving safe retries with the same request identity. Normal New chat now creates with defaults; custom settings are optional. |
| 7. Search campaign progress and type labels are wrong | Confirmed | Search campaigns show scored/found progress; application campaigns show applied/qualified progress. Labels use the public campaign names. |
| 8. Active count is page-limited and loading looks like zero | Confirmed | Dashboard uses the filtered server pagination total across the account. Tiles have loading placeholders and error recovery. |
| 9. Chat flashes an empty call to action during loading | Confirmed | Loading, failure, selected-thread, and genuinely empty states are exclusive. |
| 10. Market chips apply unrelated draft filters | Confirmed | Removed the separate filter draft. Discover controls update URL-backed filters immediately. |
| 11. Settings ignores unsaved changes | Confirmed | Dirty status controls Save and Discard; link navigation and full unload warn while the form is open. Unsaved values and their saved baseline survive in-app history navigation in memory, per account. They are not persisted across full reloads. Save cannot overwrite later edits or restore stale defaults. |
| 12. Application search disappears after navigation | Confirmed | Search lives in the URL with the other filters; requests remain debounced. |

## Other findings and requested simplifications

| Area | Verification and change |
| --- | --- |
| Desktop shell | Removed the application mobile navigation, bottom-nav height, width-based agent availability, explicit 44px chat sizing, and the reviewed chat/Discover small-screen drawer fallbacks. The sidebar remains present in a narrow window. Removed Pilot's small-screen ordering. Responsive marketing/docs layouts are outside this application-shell change. |
| Agent entry points | Chat and its computer connection are the main workflow. The sidebar footer shows one compact connection status and opens the connection controls. Pilot and direct terminal access are secondary tools enabled in Settings → Connections → Advanced tools. Conflict recovery remains available with readable text, without matching error text with a regular expression. |
| Navigation | Five primary destinations: Dashboard, Chat, Jobs, Applications, Resumes. Jobs contains Discover and Campaigns; campaign back/delete destinations use that campaign list. Analytics is linked from Applications and highlights that navigation item. Boards and Inbox are linked from Settings; Credentials remains a Settings tab. Existing routes remain usable. |
| Duplicate dashboard campaigns | Dashboard keeps ongoing activity. The complete campaign list moved to Jobs → Campaigns. Both lists paginate. |
| Duplicate application counts | The same account data appearing in a dashboard summary, filtered application history, and analytics is not itself an error. Retained those contextual summaries; fixed count/loading correctness. |
| Names and obsolete copy | Resumes replaces Documents in navigation and its page header. Removed the single-tab document switcher and the cover-letter description. Standardized campaign Pause wording and Pilot's title. Removed the obsolete Pilot dashboard card. |
| Verification prompts | Removed the duplicate checklist item and its misleading Resend link. The shared email-verification banner remains the single prompt. |
| Chat | Removed the redundant Back to dashboard link. A computer icon always exposes connection controls. Default chat creation is one click. The live browser stays beside the chat; opening it collapses the roster to preserve room on laptops. |
| Discover density and consistency | Moved source coverage/controls to Settings; filters apply immediately; removed filter draft copies. Explained salary-sort requirements and replaced touch-specific empty-state wording. Saved/applied mutations update shared query caches instead of parallel override maps. Unified application continuation labels. |
| Disabled actions | Composer setup hints link to Boards and Resumes, with load-error recovery. Pilot Start explains missing goals or an unavailable computer. |
| Internal jargon | Replaced the legacy-score label and reviewed run labels with user-facing wording. The literal `Agent: queued` claim was not found in the current rendered components. |
| Empty states | Application history distinguishes no data, filtered results, and an out-of-range page. Empty Campaigns links to actual campaign creation. |
| New-tab navigation | Campaign cards and application titles use native links so Ctrl/Cmd-click and middle-click work. Other cells do not pretend to be links. |
| Page layout | Main application pages use the shared page frame and consistent headers. Discover no longer owns a separate 1800px frame. The resume editor retains its wider workspace. |
| Onboarding | The old wizard had six steps and started with agent setup, but setup was already optional through Fill manually. It now starts with Resume and has five steps. Computer setup is optional within import; finishing does not open the terminal. |
| Draft compatibility | Replaced read-time legacy draft fallback with a persisted v4 migration before strict reading. Tests cover old step mappings, incomplete answers, role preferences, owner validation, and eligibility preservation. |
| Cleanup and effects | Removed the incomplete composer comment and redundant alias. Removed filter/search state copies where the URL can be authoritative. Effects still used for subscriptions, restoring persisted drafts, and initializing profile defaults are intentional. |
| Dead dock prediction | The dock strip, resize handle, and width setting have real users in Advanced tools. Removed the obsolete compact branch instead. Knip detects unused imports/exports/files; it does not generally prove a branch unreachable because one caller always passes a particular prop. |

## Verification

- Web TypeScript check passed.
- Web suite: **185 passed, 0 failed**, across 39 files.
- Scoped Biome checks passed for changed files.
- Repository-wide Knip passed.
- `git diff --check` passed; Git reported only existing line-ending normalization notices outside these UI changes.
- Independent review caught additional Settings save/navigation races, connection-status error handling, and advanced terminal restart behavior; those were repaired before the final checks.
- The local browser redirected `/dashboard` to sign-in. Authenticated visual and interaction checks were therefore not completed; these results are based on code review, type checking, and automated tests.

Browser Back does not reliably support a cancelable leave prompt, so Settings preserves drafts rather than manipulating browser history. See the [browser vendor's navigation documentation](https://developer.chrome.com/docs/web-platform/navigation-api#example_usage).

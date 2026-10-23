namespace OpenApply.Terminal.Queue;

internal sealed record AccountSetupCapabilities(bool AccountWorkerIsolationSupported,
    string WorkerGmailProfileAvailability, bool WorkerGmailIdentityVerified,
    bool GmailProfileRequired, bool WorkerGmailAccessVerified);
internal sealed record AccountSetupBlocker(string Code, string Message);
internal sealed record AccountSetupReadiness(bool Ready, bool ModelFree, int ModelRequests,
    AccountSetupCapabilities Capabilities, AccountSetupBlocker[] Blockers, string[]? Limitations = null);

internal static class AccountSetupPreflight
{
    internal static IResult Readiness(HttpContext context)
    {
        context.Response.Headers.CacheControl = "no-store";
        // Saved settings and a different session's connector are not proof of this worker's capabilities.
        var readiness = new AccountSetupReadiness(true, true, 0, new(true, "unverified", false, false, false), [],
        [
            "New password entry, confirmation, signup submission and binding terms require user handoff in the restricted account browser.",
            "Actual-worker Gmail search/read and fresh-code acceptance remain unverified. Exact user-confirmed mailbox pairing is sufficient when no profile tool exists; available mismatches and authorization failures stop verification.",
        ]);
        return Results.Json(readiness, AppJsonContext.Default.AccountSetupReadiness);
    }
}

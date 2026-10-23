using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using OpenApply.Terminal.Agent;

namespace OpenApply.Terminal.Queue;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
internal sealed record QueueGrantBudget(long MaxRequests, long MaxTokens, int MaxSubagents, int MaxTurns,
    int MaxWorkerTurns, decimal MaxBudgetUsd, int MaxSeconds);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
internal sealed record QueueGrantAllocation(string AllocationId, string WorkItemId, QueueGrantBudget Budget,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IntakePreparationSnapshot? Preparation = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] AccountSetupSnapshot? AccountSetup = null);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
internal sealed record QueueGrantFile(int Version, bool Approved, string Purpose, string RunId, string Provider, string Model,
    string ApprovalReference, DateTimeOffset ApprovedAt, DateTimeOffset ExpiresAt, bool AcceptObservedLimitOvershoot,
    int MaxAutomaticRetries, int MaxConcurrentWorkers, QueueGrantBudget Budget, QueueGrantAllocation[] Allocations);

internal sealed class QueueModelGrant
{
    internal const string EnvironmentKey = "OPENAPPLY_QUEUE_MODEL_APPROVAL";
    internal const string PreparationEnvironmentKey = "OPENAPPLY_PREPARATION_MODEL_APPROVAL";
    internal const string AccountEnvironmentKey = "OPENAPPLY_ACCOUNT_MODEL_APPROVAL";
    internal const string PilotEnvironmentKey = "OPENAPPLY_PILOT_MODEL_APPROVAL";
    internal const string PreparationIsolationReason = "Intake preparation is disabled because subscription-provider tool and context isolation has not been verified. An approval alone cannot enable it.";
    private readonly Lock sync = new();
    private readonly HashSet<string> reserved = [];
    private readonly HashSet<string> launched = [];
    private readonly HashSet<string> finished = [];
    private readonly string approvalPath;
    private readonly byte[] approvalBytes;
    private bool activated;
    private int cursor;
    private string? stopReason;
    internal QueueGrantFile Approval { get; }
    internal bool IsPreparation => Approval.Purpose == "queue-intake-prepare";
    internal bool IsAccountSetup => Approval.Purpose == "queue-account-setup";
    internal bool IsPilotScore => Approval.Purpose == "queue-pilot-score";
    internal string EvidenceDirectory { get; }
    internal CancellationTokenSource Stop { get; } = new();

    private QueueModelGrant(QueueGrantFile approval, string path, byte[] bytes, string evidenceDirectory)
    {
        Approval = approval; approvalPath = path; approvalBytes = bytes; EvidenceDirectory = evidenceDirectory;
    }

    internal static QueueModelGrant? Read(Func<string, string?> environment, string evidenceRoot, DateTimeOffset now)
    {
        var applicationPath = environment(EnvironmentKey);
        var preparationPath = environment(PreparationEnvironmentKey);
        var accountPath = environment(AccountEnvironmentKey);
        var pilotPath = environment(PilotEnvironmentKey);
        if (new[] { applicationPath, preparationPath, accountPath, pilotPath }.Count(value => !string.IsNullOrWhiteSpace(value)) > 1) throw new ModelBudgetException("Application, preparation, account and pilot approvals are mutually exclusive.");
        var preparation = !string.IsNullOrWhiteSpace(preparationPath);
        var account = !string.IsNullOrWhiteSpace(accountPath);
        var pilot = !string.IsNullOrWhiteSpace(pilotPath);
        var path = applicationPath;
        if (preparation) path = preparationPath;
        if (account) path = accountPath;
        if (pilot) path = pilotPath;
        if (string.IsNullOrWhiteSpace(path)) return null;
        if (!Path.IsPathFullyQualified(path)) throw new ModelBudgetException("Queue approval must use an absolute local path.");
        using var stream = File.OpenRead(path);
        if (stream.Length is <= 0 or > 65536) throw new ModelBudgetException("Queue approval is invalid.");
        var bytes = new byte[checked((int)stream.Length)]; stream.ReadExactly(bytes);
        if (stream.ReadByte() != -1) throw new ModelBudgetException("Queue approval changed while reading.");
        var approval = Validate(bytes, now, preparation, account, pilot);
        return new(approval, Path.GetFullPath(path), bytes, Path.Combine(evidenceRoot, approval.RunId));
    }

    internal static QueueGrantFile Validate(byte[] bytes, DateTimeOffset now, bool preparation = false, bool account = false, bool pilot = false)
    {
        try
        {
            // Typed deserialization keeps the last duplicate key, which could hide a swapped value.
            using var json = JsonDocument.Parse(bytes, new JsonDocumentOptions { AllowDuplicateProperties = false });
            var value = JsonSerializer.Deserialize(bytes, AppJsonContext.Default.QueueGrantFile) ?? throw new FormatException();
            var purpose = "queue-application";
            if (preparation) purpose = "queue-intake-prepare";
            if (account) purpose = "queue-account-setup";
            if (pilot) purpose = "queue-pilot-score";
            if (new[] { preparation, account, pilot }.Count(flag => flag) > 1) throw new FormatException();
            if (value.Version != 1 || !value.Approved || value.Purpose != purpose || value.Provider != "claude" || value.Model != "sonnet"
                || !Id(value.RunId) || value.ApprovalReference is not { Length: > 0 and <= 200 }
                || value.ApprovalReference.Any(c => !char.IsAsciiLetterOrDigit(c) && !":/_.-".Contains(c))
                || value.ApprovedAt > now || value.ExpiresAt <= now || value.ExpiresAt <= value.ApprovedAt
                || value.ExpiresAt - value.ApprovedAt > TimeSpan.FromHours(24) || value.MaxAutomaticRetries != 0
                || !value.AcceptObservedLimitOvershoot || value.MaxConcurrentWorkers is < 1 or > 3
                || value.Allocations is not { Length: > 0 and <= 100 } || value.Allocations.Any(item => item is null)
                || value.Allocations.Select(item => item.AllocationId).Distinct().Count() != value.Allocations.Length
                || value.Allocations.Select(item => item.WorkItemId).Distinct().Count() != value.Allocations.Length) throw new FormatException();
            if ((preparation || account || pilot) && (value.MaxConcurrentWorkers != 1 || value.Allocations.Length != 1)) throw new FormatException();
            if (account && value.Budget.MaxSubagents != 0) throw new FormatException();
            ValidBudget(value.Budget);
            foreach (var item in value.Allocations)
            {
                if (!Id(item.AllocationId) || !Id(item.WorkItemId)) throw new FormatException();
                if (preparation) ValidateSnapshot(item.Preparation, item.WorkItemId, value.Provider);
                else if (item.Preparation is not null) throw new FormatException();
                if (account)
                {
                    ValidateAccountSnapshot(item.AccountSetup, item.WorkItemId, value.Provider);
                    if (item.Budget.MaxSubagents != 0) throw new FormatException();
                }
                else if (item.AccountSetup is not null) throw new FormatException();
                ValidBudget(item.Budget);
                if (item.Budget.MaxSeconds > value.Budget.MaxSeconds || item.Budget.MaxWorkerTurns > value.Budget.MaxWorkerTurns) throw new FormatException();
            }
            if (value.Allocations.Sum(item => item.Budget.MaxRequests) > value.Budget.MaxRequests
                || value.Allocations.Sum(item => item.Budget.MaxTokens) > value.Budget.MaxTokens
                || value.Allocations.Sum(item => item.Budget.MaxSubagents) > value.Budget.MaxSubagents
                || value.Allocations.Sum(item => item.Budget.MaxTurns) > value.Budget.MaxTurns
                || value.Allocations.Sum(item => item.Budget.MaxBudgetUsd) > value.Budget.MaxBudgetUsd) throw new FormatException();
            return value;
        }
        catch (Exception ex) when (ex is JsonException or FormatException or InvalidOperationException or OverflowException or ArgumentException)
        { throw new ModelBudgetException("Model execution is disabled because the queue approval or aggregate allocations are invalid."); }
    }

    internal string? BlockingReason(DateTimeOffset now)
    {
        lock (sync)
        {
            if (stopReason is not null) return stopReason;
            if (Stop.IsCancellationRequested) return "The shared model run has stopped; no allocation may be retried.";
            if (now >= Approval.ExpiresAt) return "The queue model approval has expired.";
            if (!activated && (File.Exists(approvalPath + ".used") || Directory.Exists(EvidenceDirectory))) return "The queue model approval has already been used.";
            if (finished.Count == Approval.Allocations.Length) return "All approved model allocations have been used; no automatic retry is allowed.";
            return null;
        }
    }

    internal void Activate(DateTimeOffset now)
    {
        lock (sync)
        {
            if (activated) return;
            if (BlockingReason(now) is { } reason) throw new ModelBudgetException(reason);
            WriteNew(approvalPath + ".used", System.Text.Encoding.UTF8.GetBytes(Convert.ToHexStringLower(SHA256.HashData(approvalBytes))));
            Directory.CreateDirectory(EvidenceDirectory);
            WriteNew(Path.Combine(EvidenceDirectory, "grant.used"), System.Text.Encoding.UTF8.GetBytes(Convert.ToHexStringLower(SHA256.HashData(approvalBytes))));
            activated = true;
            Stop.CancelAfter(TimeSpan.FromMilliseconds(Math.Min(Approval.Budget.MaxSeconds * 1000, (Approval.ExpiresAt - now).TotalMilliseconds)));
        }
    }

    internal QueueGrantAllocation? Reserve(string? workItemId = null)
    {
        lock (sync)
        {
            if (!activated || Stop.IsCancellationRequested || BlockingReason(DateTimeOffset.UtcNow) is not null) return null;
            var item = Enumerable.Range(0, Approval.Allocations.Length).Select(index => Approval.Allocations[(index + cursor) % Approval.Allocations.Length])
                .FirstOrDefault(item => (workItemId is null || item.WorkItemId == workItemId) && !reserved.Contains(item.AllocationId) && !launched.Contains(item.AllocationId) && !finished.Contains(item.AllocationId));
            if (item is not null) cursor = (Array.IndexOf(Approval.Allocations, item) + 1) % Approval.Allocations.Length;
            if (item is not null) reserved.Add(item.AllocationId);
            return item;
        }
    }

    internal void NoClaim(QueueGrantAllocation allocation) { lock (sync) { if (!launched.Contains(allocation.AllocationId)) reserved.Remove(allocation.AllocationId); } }
    internal ModelBudget BudgetFor(QueueGrantAllocation allocation)
    {
        if (!Approval.Allocations.Contains(allocation)) throw new ModelBudgetException("Unknown model allocation.");
        var budget = allocation.Budget;
        return new(budget.MaxRequests, budget.MaxTokens, budget.MaxSubagents, budget.MaxTurns, budget.MaxWorkerTurns,
            budget.MaxBudgetUsd, budget.MaxSeconds, Path.Combine(EvidenceDirectory, allocation.AllocationId + ".usage.jsonl"))
        { UsageContext = new(Approval.RunId, allocation.AllocationId, allocation.WorkItemId, Approval.Purpose, Approval.Model) };
    }
    internal ModelBudget Launch(QueueGrantAllocation allocation)
    {
        lock (sync)
        {
            if (!reserved.Contains(allocation.AllocationId) || launched.Contains(allocation.AllocationId) || Stop.IsCancellationRequested || DateTimeOffset.UtcNow >= Approval.ExpiresAt) throw new ModelBudgetException("The model allocation cannot be reused.");
            WriteNew(Path.Combine(EvidenceDirectory, allocation.AllocationId + ".launch"), System.Text.Encoding.UTF8.GetBytes(allocation.WorkItemId));
            launched.Add(allocation.AllocationId);
            return BudgetFor(allocation);
        }
    }

    internal void Finish(QueueGrantAllocation allocation) { lock (sync) { finished.Add(allocation.AllocationId); reserved.Remove(allocation.AllocationId); } }
    internal void Cancel(string reason)
    {
        lock (sync) stopReason ??= reason;
        Stop.Cancel();
    }
    internal int Remaining { get { lock (sync) return Approval.Allocations.Count(item => !launched.Contains(item.AllocationId) && !finished.Contains(item.AllocationId)); } }
    internal string[] PendingIds { get { lock (sync) return Approval.Allocations.Where(item => !reserved.Contains(item.AllocationId) && !launched.Contains(item.AllocationId) && !finished.Contains(item.AllocationId)).Select(item => item.WorkItemId).ToArray(); } }
    internal static void ValidateSnapshot(IntakePreparationSnapshot? value, string workItemId, string provider)
    {
        if (value is null || value.Version != 1 || value.Purpose != "intake_prepare" || value.WorkItemId != workItemId || value.Provider != provider
            || !Id(value.IntakeId) || !Id(value.JobId) || !Id(value.CampaignId) || !Id(value.ResumeId) || value.IntakeRevision < 1
            || value.JobKey is not { Length: > 0 and <= 200 } || value.Url is not { Length: > 0 and <= 4000 }
            || !Uri.TryCreate(value.Url, UriKind.Absolute, out var url) || url.UserInfo.Length != 0 || url.Fragment.Length != 0
            || (url.Scheme != "https" && !(url.Scheme == "http" && url.IsLoopback))
            || new[] { value.SourceSha256, value.SourceTextSha256, value.PreferencesSha256, value.SnapshotHash }.Any(hash => hash is not { Length: 64 } || hash.Any(c => !char.IsAsciiHexDigitLower(c)))) throw new FormatException("Invalid exact preparation snapshot.");
    }
    internal static void ValidateAccountSnapshot(AccountSetupSnapshot? value, string workItemId, string provider)
    {
        if (value is null || value.Version != 2 || value.Revision < 1 || value.Purpose != "account_setup" || value.Provider != "claude" || value.Provider != provider
            || value.WorkItemId != workItemId || !Id(value.WorkItemId) || !Id(value.CredentialId) || value.Operation is not ("signup" or "inspect")
            || value.AccountStatus is not ("unknown" or "absent_confirmed") || value.MaxSignupAttempts != 1 || value.SubmissionAllowed
            || value.Email is not { Length: > 0 and <= 320 } || value.Email != value.Email.Trim().ToLowerInvariant()
            || !System.Net.Mail.MailAddress.TryCreate(value.Email, out var email) || email.Address != value.Email
            || new[] { value.SnapshotHash, value.CredentialRevision }.Any(hash => hash is not { Length: 64 } || hash.Any(c => !char.IsAsciiHexDigitLower(c)))
            || !Uri.TryCreate(value.SignupUrl, UriKind.Absolute, out var url) || value.SignupUrl.Length > 4000 || url.Scheme != "https"
            || url.UserInfo.Length != 0 || url.Fragment.Length != 0 || !url.IsDefaultPort || url.Host.EndsWith('.')
            || !Uri.TryCreate(value.TenantOrigin, UriKind.Absolute, out var origin) || value.TenantOrigin != origin.GetLeftPart(UriPartial.Authority)
            || url.GetLeftPart(UriPartial.Authority) != value.TenantOrigin)
            throw new FormatException("Invalid exact account snapshot.");
    }
    internal static void WriteNew(string path, byte[] contents)
    {
        using var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.Read);
        if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        stream.Write(contents);
        stream.Flush(true);
    }
    private static bool Id(string? value) => Guid.TryParseExact(value, "D", out var id) && id.ToString("D") == value;
    private static void ValidBudget(QueueGrantBudget? value)
    {
        if (value is null || value.MaxRequests is < 1 or > 1000 || value.MaxTokens is < 1 or > 100_000_000
            || value.MaxSubagents is < 0 or > 100 || value.MaxTurns is < 1 or > 1000 || value.MaxWorkerTurns is < 1 or > 200
            || value.MaxBudgetUsd is <= 0 or > 100 || value.MaxSeconds is < 1 or > 3600) throw new FormatException();
    }
}

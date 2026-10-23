using OpenApply.Terminal.Agent;
using System.Text.Json.Serialization;

namespace OpenApply.Terminal.Queue;

public sealed record QueueWorkerStatus(string WorkerId, int Slot, string WorkItemId, string ExecutionId, string BrowserSessionId, string State);
public sealed record QueueBudgetStatus(bool Enabled, int RemainingAllocations, string? Reason);
public sealed record QueueStatus(bool Connected, bool Running, string? BlockingReason, string? LastError,
    int ConfiguredCapacity = 1, int EffectiveCapacity = 0, QueueWorkerStatus[]? Workers = null, QueueBudgetStatus? Budget = null, string? OwnerId = null, string? ConnectionId = null);
internal sealed record QueueIdentity(string Id);
internal sealed record QueueObserver(string OwnerId, string WorkItemId, string ExecutionId, string BrowserSessionId,
    string State, DateTimeOffset? LeaseExpiresAt, bool Active, string? CurrentExecutionId = null);
internal sealed record QueueOrderRequest(string[] WorkItemIds);
internal sealed record QueueOrderItem(string WorkItemId, bool Eligible, string? BlockedReason, DateTimeOffset? NextEligibleAt, DateTimeOffset? PriorityRequestedAt);
internal sealed record QueueOrder(DateTimeOffset ServerTime, QueueOrderItem[] Items);
internal sealed record QueueRunnable(string[] ApplicationIds, string[] AccountIds, string[] PilotIds, int MaxConcurrentWorkers, int? RunsRemaining);
internal sealed record QueueFrame(string WorkItemId, string ExecutionId, string BrowserSessionId, DateTimeOffset CapturedAt,
    string MimeType, string ImageBase64, int Width, int Height);
internal sealed record WorkItem(string Id, string Kind, string State, string? JobId = null,
    DateTimeOffset? CancellationRequestedAt = null, DateTimeOffset? PauseRequestedAt = null, DateTimeOffset? LeaseExpiresAt = null,
    string? CampaignId = null, string? ApplicationId = null, string? JobKey = null);
internal sealed record QueueJob(string Id, string CampaignId, string Key, string Title, string Company, string Url);
internal sealed record QueueScorePage(string JobId, string Url);
internal sealed record QueueExecution(string Provider, string Agent, string Prompt, string Instructions,
    string? ProviderSessionId, string? Intent = null, QueueJob? Job = null, IntakePreparationExecution? Preparation = null,
    AccountSetupExecution? AccountSetup = null, QueueScorePage[]? ScorePages = null);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
internal sealed record AccountSetupSnapshot(int Version, int Revision, string Operation, string CredentialRevision,
    string Purpose, string WorkItemId, string Provider, string SignupUrl, string TenantOrigin, string CredentialId,
    string Email, string AccountStatus, int MaxSignupAttempts, bool SubmissionAllowed, string SnapshotHash);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
internal sealed record AccountSetupExecution(AccountSetupSnapshot Snapshot, string ApiToken);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
internal sealed record IntakePreparationSnapshot(int Version, string Purpose, string WorkItemId, string IntakeId, int IntakeRevision,
    string JobId, string CampaignId, string JobKey, string Url, string Provider, string ResumeId,
    string SourceSha256, string SourceTextSha256, string PreferencesSha256, string SnapshotHash);
internal sealed record IntakePreparationExecution(IntakePreparationSnapshot Snapshot, string ApiToken);
internal sealed record QueueOwnership(string RuntimeId, string WorkerId, int Slot, string ExecutionId, string BrowserSessionId);
internal sealed record QueueCapabilities(bool IsolatedBrowser = true,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] bool? AccountSetup = null);
internal sealed record QueueClaimRequest(string RequestId, string RuntimeId, string WorkerId, string WorkItemId, QueueCapabilities Capabilities,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? PreparationSnapshotHash = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? AccountSnapshotHash = null);
internal sealed record QueueClaimResponse(QueueClaim? Claim, DateTimeOffset ServerTime, string? BlockedReason, DateTimeOffset? NextEligibleAt);
internal sealed record QueueClaim(WorkItem Item, string LeaseToken, QueueExecution Execution, QueueOwnership? Ownership = null,
    DateTimeOffset? LeaseExpiresAt = null, int PolicyRevision = 0)
{
    internal AgentRequest Request => new(Item.Id, LeaseToken, Execution.Provider, Execution.Prompt, Execution.Instructions,
        Execution.ProviderSessionId, Preparation: Execution.Preparation?.Snapshot,
        AccountSetup: Execution.AccountSetup?.Snapshot);
}
internal sealed record AgentRequest(string WorkItemId, string LeaseToken, string Provider, string Prompt, string Instructions,
    string? ProviderSessionId, ModelBudget? Budget = null, QueueBrowserSession? Browser = null, IntakePreparationSnapshot? Preparation = null,
    QueuePluginStage? PluginStage = null, AccountSetupSnapshot? AccountSetup = null);

using System.Text.Json.Serialization;
using OpenApply.Terminal.Agent;
using OpenApply.Terminal.Queue;
using OpenApply.Terminal.Presence;
using OpenApply.Terminal.Questions;
using OpenApply.Terminal.Preparation;
using OpenApply.Terminal.Inference;
using System.Text.Json.Nodes;
using OpenApply.Terminal.Connectors;
using OpenApply.Terminal.Hosting;
using OpenApply.Terminal.Pilot;
using OpenApply.Terminal.Providers;
using OpenApply.Terminal.Sessions;
using OpenApply.Terminal.Updates;
using Microsoft.AspNetCore.Mvc;

namespace OpenApply.Terminal;

/// <summary>
/// Native AOT JSON metadata. JIT reflection can hide missing registrations, so every directly serialized
/// type must appear here; the camel-case policy also defines the WebSocket and ProblemDetails wire format.
/// </summary>
[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(StartSessionRequest))]
[JsonSerializable(typeof(ConnectRequest))]
[JsonSerializable(typeof(QueueClaim))]
[JsonSerializable(typeof(QueueClaimRequest))]
[JsonSerializable(typeof(QueueClaimResponse))]
[JsonSerializable(typeof(QueueGrantFile))]
[JsonSerializable(typeof(QueueStatus))]
[JsonSerializable(typeof(AccountSetupReadiness))]
[JsonSerializable(typeof(AccountSetupSnapshot))]
[JsonSerializable(typeof(AccountLaunchRequest))]
[JsonSerializable(typeof(AccountHandoffStatus))]
[JsonSerializable(typeof(AccountControlRequest))]
[JsonSerializable(typeof(AccountToolState))]
[JsonSerializable(typeof(QueueIdentity))]
[JsonSerializable(typeof(QueueFrame))]
[JsonSerializable(typeof(QueueObserver))]
[JsonSerializable(typeof(QueueOrder))]
[JsonSerializable(typeof(QueueRunnable))]
[JsonSerializable(typeof(QueueOrderRequest))]
[JsonSerializable(typeof(RuntimeHeartbeat))]
[JsonSerializable(typeof(WorkItem))]
[JsonSerializable(typeof(QuestionCollectRequest))]
[JsonSerializable(typeof(QuestionCollectResult))]
[JsonSerializable(typeof(QuestionSnapshot))]
[JsonSerializable(typeof(QuestionBrowserRequest))]
[JsonSerializable(typeof(QuestionObservation))]
[JsonSerializable(typeof(QuestionStoreRequest))]
[JsonSerializable(typeof(PreparationRequest))]
[JsonSerializable(typeof(PreparationResult))]
[JsonSerializable(typeof(PreparationManifest))]
[JsonSerializable(typeof(PreparationStoreRequest))]
[JsonSerializable(typeof(PreparationStored))]
[JsonSerializable(typeof(PreparationBrowserRequest))]
[JsonSerializable(typeof(PreparationObservation))]
[JsonSerializable(typeof(WorkLease))]
[JsonSerializable(typeof(WorkEvent))]
[JsonSerializable(typeof(WorkFinish))]
[JsonSerializable(typeof(InferenceRequest))]
[JsonSerializable(typeof(InferenceResponse))]
[JsonSerializable(typeof(JsonObject))]
[JsonSerializable(typeof(GmailCheckRequest))]
[JsonSerializable(typeof(GmailCheckResponse))]
[JsonSerializable(typeof(GmailCheckEvidence))]
[JsonSerializable(typeof(CodexSettingsFile))]
[JsonSerializable(typeof(PluginMcpFile))]
[JsonSerializable(typeof(string))]
[JsonSerializable(typeof(PilotStartRequest))]
[JsonSerializable(typeof(BrowserMessage))]
[JsonSerializable(typeof(StatusResponse))]
[JsonSerializable(typeof(HostRuntime))]
[JsonSerializable(typeof(PilotSettingsFile))]
[JsonSerializable(typeof(JournalRequest))]
[JsonSerializable(typeof(PilotActivity))]
[JsonSerializable(typeof(PilotScheduleResult))]
[JsonSerializable(typeof(PilotScheduleRequest))]
[JsonSerializable(typeof(PilotEvent))]
[JsonSerializable(typeof(UpdateResult))]
[JsonSerializable(typeof(ShutdownResult))]
[JsonSerializable(typeof(ProblemDetails))]
[JsonSerializable(typeof(GitHubRelease[]))]
internal sealed partial class AppJsonContext : JsonSerializerContext;

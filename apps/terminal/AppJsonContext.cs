using System.Text.Json.Serialization;
using OpenApply.Terminal.Inference;
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
[JsonSerializable(typeof(InferenceRequest))]
[JsonSerializable(typeof(InferenceResponse))]
[JsonSerializable(typeof(GmailCheckRequest))]
[JsonSerializable(typeof(GmailCheckResponse))]
[JsonSerializable(typeof(GmailCheckEvidence))]
[JsonSerializable(typeof(CodexSettingsFile))]
[JsonSerializable(typeof(PluginMcpFile))]
[JsonSerializable(typeof(string))]
[JsonSerializable(typeof(InjectRequest))]
[JsonSerializable(typeof(PilotStartRequest))]
[JsonSerializable(typeof(BrowserMessage))]
[JsonSerializable(typeof(StatusResponse))]
[JsonSerializable(typeof(HostRuntime))]
[JsonSerializable(typeof(PilotSettingsFile))]
[JsonSerializable(typeof(JournalRequest))]
[JsonSerializable(typeof(PilotActivity))]
[JsonSerializable(typeof(PilotEvent))]
[JsonSerializable(typeof(UpdateResult))]
[JsonSerializable(typeof(ShutdownResult))]
[JsonSerializable(typeof(ProblemDetails))]
[JsonSerializable(typeof(GitHubRelease[]))]
internal sealed partial class AppJsonContext : JsonSerializerContext;

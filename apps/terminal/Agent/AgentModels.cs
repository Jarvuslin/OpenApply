using System.Text.Json.Serialization;

namespace OpenApply.Terminal.Agent;

public sealed record ConnectRequest(string ApiToken, string ApiUrl, string WebUrl);
internal sealed record ApiConnection(string ApiToken, string ApiUrl, string WebUrl);
internal sealed record WorkLease(string LeaseToken);
internal sealed record WorkEvent(string LeaseToken, string EventId, string Kind, string Content,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? ProviderSessionId = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] WorkEventMetadata? Metadata = null);
internal sealed record WorkEventMetadata(
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? ToolName = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? QuestionId = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? JobId = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? ToolInvocationId = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? SkillName = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? SubagentType = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? ToolStatus = null);
internal sealed record WorkFinish(string LeaseToken, string Status,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Error = null);
internal sealed record AgentEvent(string Kind, string Content, string? SessionId = null, string? ToolName = null, WorkEventMetadata? Metadata = null);
internal sealed record AgentResult(string Status, string? Error = null, bool UsageKnown = false);

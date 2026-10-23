using OpenApply.Terminal.Agent;

namespace OpenApply.Terminal.Queue;

internal static class QueueRedaction
{
    internal static string Clean(string value, string apiToken, string leaseToken) =>
        AgentRedaction.Clean(AgentRedaction.Clean(value, apiToken), leaseToken);

    internal static WorkEvent Event(QueueClaim claim, AgentEvent entry, string apiToken, string? capability = null, string? preparationToken = null)
    {
        if (claim.Execution.AccountSetup is not null)
        {
            // Only the tool name survives: labels, text and results can carry codes, links or mail.
            var tool = entry.Kind == "activity" && entry.ToolName is { Length: > 0 and <= 120 } name
                && System.Text.RegularExpressions.Regex.IsMatch(name, "^[A-Za-z0-9_-]+$") ? name : null;
            string content;
            if (tool is null) content = "Account worker progress is recorded in the account setup item.";
            else if (entry.Content.StartsWith("Using ", StringComparison.Ordinal)) content = $"Using {tool}.";
            else content = entry.Content.EndsWith(" failed.", StringComparison.Ordinal) ? $"{tool} failed." : $"{tool} finished.";
            return new(claim.LeaseToken, Guid.NewGuid().ToString(), "activity", content, null, null);
        }
        string Redact(string value)
        {
            if (preparationToken is not null) value = AgentRedaction.Clean(value, preparationToken);
            value = Clean(value, apiToken, claim.LeaseToken);
            return capability is null ? value : AgentRedaction.Clean(value, capability);
        }
        string? Safe(string? value) => value is not null && Redact(value) == value ? value : null;
        var metadata = entry.Metadata ?? (entry.ToolName is null ? null : new WorkEventMetadata(entry.ToolName));
        if (metadata is not null) metadata = new(Safe(metadata.ToolName), Safe(metadata.QuestionId), Safe(metadata.JobId),
            Safe(metadata.ToolInvocationId), Safe(metadata.SkillName), Safe(metadata.SubagentType), Safe(metadata.ToolStatus));
        return new(claim.LeaseToken, Guid.NewGuid().ToString(), entry.Kind,
            Redact(entry.Content), Safe(entry.SessionId), metadata);
    }
}

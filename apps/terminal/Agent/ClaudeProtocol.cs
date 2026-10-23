using System.Text.Json.Nodes;

namespace OpenApply.Terminal.Agent;

internal sealed class ClaudeProtocol(string? expectedSessionId = null)
{
    private readonly HashSet<string> messages = [];
    private readonly HashSet<string> eventIds = [];
    private readonly HashSet<string> toolIds = [];
    private readonly Dictionary<string, WorkEventMetadata> tools = [];
    private bool waiting;
    private bool reportedPermissionDenial;
    public AgentResult? Result { get; private set; }
    public string? SessionId { get; private set; }

    public List<AgentEvent> Consume(JsonObject message)
    {
        List<AgentEvent> events = [];
        var primary = message["parent_tool_use_id"] is null;
        var sessionId = AgentJson.Text(message, "session_id");
        if (primary && expectedSessionId is not null && sessionId is not null && expectedSessionId != sessionId)
            throw new InvalidDataException("Claude resumed a different conversation.");
        if (primary) SessionId = sessionId ?? SessionId;
        var type = AgentJson.Text(message, "type");
        if (primary && type == "system" && AgentJson.Text(message, "subtype") == "init")
            events.Add(new("activity", "Agent connected.", SessionId));
        if (type == "system" && AgentJson.Text(message, "subtype") == "permission_denied")
        {
            ReportPermissionDenial(events);
        }
        if (type == "assistant" && message["message"]?["content"] is JsonArray content)
        {
            // Claude reuses a message ID across separately delivered thinking, text and tool blocks.
            var eventId = AgentJson.Text(message, "uuid");
            if (eventId is not null && !eventIds.Add(eventId)) return events;
            var text = string.Join("\n\n", content.OfType<JsonObject>()
                .Where(block => AgentJson.Text(block, "type") == "text")
                .Select(block => AgentJson.Text(block, "text"))
                .Where(value => !string.IsNullOrWhiteSpace(value)));
            if (!string.IsNullOrWhiteSpace(text) && primary && messages.Add(Normalize(text)))
                events.Add(new("text", text, SessionId));
            foreach (var block in content.OfType<JsonObject>())
            {
                if (AgentJson.Text(block, "type") != "tool_use") continue;
                var toolId = AgentJson.Identifier(AgentJson.Text(block, "id"), 160);
                if (toolId is not null && !toolIds.Add(toolId)) continue;
                var name = AgentJson.ToolName(AgentJson.Text(block, "name"));
                if (name == "AskUserQuestion" && block["input"]?["questions"] is JsonArray questions)
                {
                    foreach (var question in questions.OfType<JsonObject>())
                    {
                        if (AgentJson.Text(question, "question") is not { } prompt || string.IsNullOrWhiteSpace(prompt)) continue;
                        waiting = true;
                        events.Add(new("question", prompt, SessionId));
                    }
                }
                else
                {
                    var metadata = new WorkEventMetadata(name,
                        ToolInvocationId: toolId,
                        SkillName: name == "Skill" ? AgentJson.Identifier(AgentJson.Text(block["input"], "skill")) : null,
                        SubagentType: name is "Agent" or "Task" ? AgentJson.Identifier(AgentJson.Text(block["input"], "subagent_type")) : null,
                        ToolStatus: "started");
                    if (metadata.ToolInvocationId is { } id) tools[id] = metadata;
                    var label = metadata.SkillName ?? metadata.SubagentType;
                    events.Add(new("activity", "Using " + name + (label is null ? "." : " (" + label + ")."), SessionId, name, metadata));
                }
            }
        }
        if (type == "user" && message["message"]?["content"] is JsonArray results)
        {
            foreach (var block in results.OfType<JsonObject>())
            {
                if (AgentJson.Text(block, "type") != "tool_result" ||
                    AgentJson.Text(block, "tool_use_id") is not { } id || !tools.Remove(id, out var metadata)) continue;
                var failed = block["is_error"] is JsonValue error && error.TryGetValue<bool>(out var value) && value;
                metadata = metadata with { ToolStatus = failed ? "failed" : "completed" };
                events.Add(new("activity", metadata.ToolName + (failed ? " failed." : " finished."), SessionId, metadata.ToolName, metadata));
            }
        }
        if (primary && type == "result")
        {
            if (message["permission_denials"] is JsonArray { Count: > 0 })
            {
                ReportPermissionDenial(events);
            }
            if (AgentJson.Text(message, "result") is { } text && messages.Add(Normalize(text))) events.Add(new("text", text, SessionId));
            if (message["is_error"] is not JsonValue error || !error.TryGetValue<bool>(out var failed))
                throw new InvalidDataException("Claude returned a completion without a valid outcome.");
            var status = failed ? "failed" : "completed";
            if (!failed && waiting) status = "waiting";
            Result = new(status, failed ? "Claude reported that the turn did not complete." : null);
        }
        return events;
    }

    private void ReportPermissionDenial(List<AgentEvent> events)
    {
        // A denied request has ended; it is not an unanswered question or proof the whole turn failed.
        if (reportedPermissionDenial) return;
        reportedPermissionDenial = true;
        events.Add(new("error", "Runtime permissions blocked a tool action. It was not approved or performed. Check the final reply for any unfinished work; this expired request cannot be approved later.", SessionId));
    }

    private static string Normalize(string text) => string.Join(' ', text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
}

internal static class AgentJson
{
    public static string? Text(JsonNode? node, string key) => node?[key] is JsonValue value && value.TryGetValue<string>(out var text) ? text : null;
    public static string ToolName(string? name) => name is { Length: > 0 and <= 120 } && name.All(c => char.IsAsciiLetterOrDigit(c) || c is '_' or '-' or '.') ? name : "agent tool";
    public static string? Identifier(string? value, int maxLength = 120) => value is { Length: > 0 } && value.Length <= maxLength && value.All(c => char.IsAsciiLetterOrDigit(c) || c is '_' or '-' or '.' or ':') ? value : null;
}

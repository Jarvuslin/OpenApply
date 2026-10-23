using System.Text.Json.Nodes;

namespace OpenApply.Terminal.Agent;

internal sealed class CodexProtocol(string workingDirectory, string? previousSessionId, string prompt)
{
    private readonly HashSet<string> seen = [];
    private readonly Dictionary<string, WorkEventMetadata> tools = [];
    private bool waiting;
    private string? turnId;
    public AgentResult? Result { get; private set; }
    public string? SessionId { get; private set; }

    public static JsonObject Initialize() => Request(1, "initialize", new JsonObject
    {
        ["clientInfo"] = new JsonObject { ["name"] = "openapply", ["title"] = "OpenApply", ["version"] = Hosting.HostInstall.HostVersion },
    });

    public (List<JsonObject> Replies, List<AgentEvent> Events) Consume(JsonObject message)
    {
        List<JsonObject> replies = [];
        List<AgentEvent> events = [];
        var method = AgentJson.Text(message, "method");
        if (method is null && message["error"] is not null)
        {
            Result = new("failed", "Codex rejected the request. Check sign-in and runtime configuration in Diagnostics.");
            return (replies, events);
        }
        if (method is null && message["id"]?.ToJsonString() == "1")
        {
            replies.Add(new JsonObject { ["method"] = "initialized", ["params"] = new JsonObject() });
            var options = new JsonObject { ["cwd"] = workingDirectory, ["approvalPolicy"] = "on-request", ["sandbox"] = "workspace-write" };
            if (previousSessionId is not null) options["threadId"] = previousSessionId;
            replies.Add(Request(2, previousSessionId is null ? "thread/start" : "thread/resume", options));
        }
        if (method is null && message["id"]?.ToJsonString() == "2")
        {
            SessionId = AgentJson.Text(message["result"]?["thread"], "id");
            if (SessionId is null) throw new InvalidDataException("Codex did not provide a conversation ID.");
            if (previousSessionId is not null && SessionId != previousSessionId)
                throw new InvalidDataException("Codex resumed a different conversation.");
            events.Add(new("activity", "Agent connected.", SessionId));
            replies.Add(Request(3, "turn/start", new JsonObject
            {
                ["threadId"] = SessionId,
                ["input"] = new JsonArray(new JsonObject { ["type"] = "text", ["text"] = prompt }),
            }));
        }
        var parameters = message["params"];
        if (method is null && message["id"]?.ToJsonString() == "3")
            turnId = AgentJson.Text(message["result"]?["turn"], "id") ?? turnId;
        var eventThreadId = AgentJson.Text(parameters, "threadId");
        if (message["id"] is null && eventThreadId is not null && eventThreadId != SessionId) return (replies, events);
        if (method == "turn/started") turnId = AgentJson.Text(parameters?["turn"], "id");
        if (method is not null && message["id"] is not null)
        {
            if (method == "item/tool/requestUserInput" && parameters?["questions"] is JsonArray questions)
            {
                foreach (var question in questions.OfType<JsonObject>())
                {
                    if (AgentJson.Text(question, "question") is not { } text || string.IsNullOrWhiteSpace(text)) continue;
                    waiting = true;
                    events.Add(new("question", text, SessionId));
                }
                replies.Add(Response(message, new JsonObject { ["answers"] = new JsonObject() }));
            }
            else if (method is "item/commandExecution/requestApproval" or "item/fileChange/requestApproval")
            {
                events.Add(new("error", "OpenApply declined a runtime permission request. The action was not approved. Check the final reply for any unfinished work; this expired request cannot be approved later.", SessionId));
                replies.Add(Response(message, new JsonObject { ["decision"] = "decline" }));
            }
            else if (method == "item/permissions/requestApproval")
            {
                events.Add(new("error", "Codex requested additional filesystem or network permissions. OpenApply has not granted them; this request is closed.", SessionId));
                replies.Add(Response(message, new JsonObject { ["permissions"] = new JsonObject(), ["scope"] = "turn" }));
            }
            else if (method == "mcpServer/elicitation/request")
            {
                waiting = true;
                events.Add(new("question", AgentJson.Text(parameters, "message") ?? "A connected tool needs your input before continuing.", SessionId));
                replies.Add(Response(message, new JsonObject { ["action"] = "decline" }));
            }
            else
            {
                events.Add(new("error", "The agent requested an interaction OpenApply cannot yet handle. The action was not approved; check its final reply for any unfinished work.", SessionId));
                replies.Add(new JsonObject { ["id"] = message["id"]!.DeepClone(), ["error"] = new JsonObject { ["code"] = -32601, ["message"] = "Unsupported client request" } });
            }
        }
        if (method is "item/started" or "item/completed" && parameters?["item"] is JsonObject item)
        {
            var type = AgentJson.Text(item, "type");
            var id = AgentJson.Text(item, "id") ?? "";
            if (method == "item/completed" && type == "agentMessage" && AgentJson.Text(item, "text") is { } text && seen.Add("text:" + id))
                events.Add(new("text", text, SessionId));
            if (method == "item/started" && type is "commandExecution" or "fileChange" or "mcpToolCall" or "webSearch" && seen.Add("tool:" + id))
            {
                var name = AgentJson.ToolName(type == "mcpToolCall" ? AgentJson.Text(item, "tool") : type);
                var metadata = new WorkEventMetadata(name, ToolInvocationId: AgentJson.Identifier(id, 160), ToolStatus: "started");
                if (metadata.ToolInvocationId is not null) tools[id] = metadata;
                events.Add(new("activity", "Using " + name + ".", SessionId, name, metadata));
            }
            if (method == "item/completed" && tools.Remove(id, out var completed))
            {
                var status = AgentJson.Text(item, "status");
                if (status is "completed" or "failed")
                {
                    completed = completed with { ToolStatus = status };
                    events.Add(new("activity", completed.ToolName + (status == "failed" ? " failed." : " finished."), SessionId, completed.ToolName, completed));
                }
            }
        }
        if (method == "turn/completed")
        {
            if (SessionId is null || turnId is null || AgentJson.Text(parameters?["turn"], "id") != turnId) return (replies, events);
            var status = AgentJson.Text(parameters?["turn"], "status");
            Result = status switch
            {
                "completed" => new(waiting ? "waiting" : "completed"),
                "interrupted" => new("interrupted", "The agent turn was interrupted. Review its last actions before continuing."),
                _ => new("failed", "Codex reported that the turn did not complete."),
            };
        }
        return (replies, events);
    }

    private static JsonObject Request(int id, string method, JsonObject parameters) => new() { ["id"] = id, ["method"] = method, ["params"] = parameters };
    private static JsonObject Response(JsonObject request, JsonObject result) => new() { ["id"] = request["id"]!.DeepClone(), ["result"] = result };
}

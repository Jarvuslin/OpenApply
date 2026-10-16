using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace OpenApply.Terminal.Queue;

internal sealed class AccountToolState
{
    public AccountSetupSnapshot? Snapshot { get; set; }
    public JsonObject? Verification { get; set; }
    public bool MailboxConfirmed { get; set; }
    public bool Blocked { get; set; }
    public bool ProfileDiscovered { get; set; }
    public bool ProfileVerified { get; set; }
    public string? ProfileCall { get; set; }
    public string? SearchCall { get; set; }
    public string? PendingTool { get; set; }
    public string? MailboxFailure { get; set; }
    public string? ObservedMailbox { get; set; }
    public int Discoveries { get; set; }
    public int AccountDiscoveries { get; set; }
    public HashSet<string> MessageIds { get; set; } = [];
    public HashSet<string> ReadIds { get; set; } = [];
    // Tool names only, so a run that stops before searching shows what it could see.
    public HashSet<string> DiscoveredTools { get; set; } = [];
}

internal static class AccountToolGate
{
    internal const string Flag = "--account-tool-hook";
    private const string Prefix = "mcp__openapply_account__";
    private const string Denied = "{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"deny\",\"permissionDecisionReason\":\"This account operation is outside its exact account and verification scope.\"}}";
    private const string Allowed = "{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"allow\"}}";

    internal static async Task<int> RunAsync(string path, string stage, TextReader input, TextWriter output)
    {
        try
        {
            using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(4));
            var buffer = new char[512 * 1024 + 1];
            var size = 0;
            while (await input.ReadAsync(buffer.AsMemory(size), deadline.Token) is var read && read > 0)
            {
                size += read;
                if (size == buffer.Length) throw new InvalidDataException();
            }
            var message = JsonNode.Parse(new string(buffer, 0, size)) as JsonObject ?? throw new InvalidDataException();
            using var file = new FileStream(path, FileMode.Open, FileAccess.ReadWrite, FileShare.None);
            if (file.Length > 131072) throw new InvalidDataException();
            var state = JsonSerializer.Deserialize(file, AppJsonContext.Default.AccountToolState) ?? throw new InvalidDataException();
            var allowed = stage == "pre" ? Allow(message, state) : stage == "post" && Observe(message, state);
            file.Position = 0;
            JsonSerializer.Serialize(file, state, AppJsonContext.Default.AccountToolState);
            file.SetLength(file.Position);
            var result = "{}";
            if (stage == "pre") result = allowed ? Allowed : Denied;
            await output.WriteAsync(result);
            return 0;
        }
        catch (Exception ex) when (ex is IOException or JsonException or InvalidOperationException or ArgumentException or OperationCanceledException or UnauthorizedAccessException)
        {
            await output.WriteAsync(Denied);
            return 2;
        }
    }

    internal static bool Allow(JsonObject hook, AccountToolState state)
    {
        if (Text(hook, "hook_event_name") != "PreToolUse" || state.Snapshot is null) return false;
        var tool = Text(hook, "tool_name");
        if (tool is "StructuredOutput" or "EndConversation") return true;
        if (hook["tool_input"] is not JsonObject input || state.PendingTool is not null) return false;
        if (tool?.StartsWith(Prefix, StringComparison.Ordinal) == true && QueueRuntime.AccountOperations.Contains(tool[Prefix.Length..]))
        {
            if (state.Blocked && tool != Prefix + "request_help") return false;
            state.PendingTool = tool;
            return true;
        }
        if (state.Blocked) return false;
        if (tool == "ToolSearch")
        {
            var query = Text(input, "query");
            if (query is null || query.Length > 300) return false;
            if (query.Contains("openapply_account", StringComparison.Ordinal))
            {
                if (state.AccountDiscoveries >= 2) return false;
                state.AccountDiscoveries++;
            }
            else
            {
                if (state.Discoveries >= 2 || !query.Contains("gmail", StringComparison.OrdinalIgnoreCase)) return false;
                state.Discoveries++;
            }
            state.PendingTool = tool;
            return true;
        }
        var id = Text(hook, "tool_use_id");
        if (id is not { Length: > 0 and <= 200 }) return false;
        if (tool is "mcp__claude_ai_Gmail__get_profile" or "mcp__claude_ai_Gmail__get_user_profile")
        {
            if (state.ProfileCall is not null || input.Any(pair => pair.Key is not ("userId" or "user_id") || pair.Value?.GetValue<string>() != "me")) return false;
            state.ProfileCall = id; state.PendingTool = tool;
            return true;
        }
        if ((!state.ProfileVerified && (!state.MailboxConfirmed || state.ProfileDiscovered || state.ProfileCall is not null)) || state.Verification is null) return false;
        if (tool == "mcp__claude_ai_Gmail__search_threads" && state.SearchCall is null && input.Count == 3 && Text(input, "query") == Query(state.Verification)
            && Text(input, "view") == "THREAD_VIEW_METADATA_ONLY" && input["pageSize"] is JsonValue size && size.TryGetValue<int>(out var count) && count is >= 1 and <= 10)
        {
            state.SearchCall = id; state.PendingTool = tool;
            return true;
        }
        // The claude.ai Gmail connector reads mail per thread; it has no get_message.
        if (tool == "mcp__claude_ai_Gmail__get_thread" && state.ReadIds.Count < 3)
        {
            var thread = Text(input, "threadId");
            if (thread is null || !state.MessageIds.Contains(thread) || state.ReadIds.Contains(thread)
                || input.Any(pair => pair.Key is not ("threadId" or "messageFormat"))) return false;
            state.ReadIds.Add(thread); state.PendingTool = tool;
            return true;
        }
        if (tool == "mcp__claude_ai_Gmail__get_message" && state.ReadIds.Count < 3)
        {
            var message = Text(input, "messageId") ?? Text(input, "id");
            if (message is null || input.ContainsKey("messageId") && input.ContainsKey("id") || !state.MessageIds.Contains(message) || state.ReadIds.Contains(message)
                || input.Any(pair => pair.Key is not ("messageId" or "id" or "format" or "view"))) return false;
            state.ReadIds.Add(message); state.PendingTool = tool;
            return true;
        }
        return false;
    }

    internal static bool Observe(JsonObject hook, AccountToolState state)
    {
        if (Text(hook, "hook_event_name") is not ("PostToolUse" or "PostToolUseFailure")) return false;
        var tool = Text(hook, "tool_name");
        if (tool != state.PendingTool || tool is null) return false;
        state.PendingTool = null;
        var response = hook["tool_response"];
        if (Text(hook, "hook_event_name") == "PostToolUseFailure" || response is null || HasError(response))
        {
            state.Blocked = true;
            if (tool.StartsWith("mcp__claude_ai_Gmail__", StringComparison.Ordinal)) state.MailboxFailure = "authorization_failed";
            return false;
        }
        var nodes = Nodes(response).ToArray();
        if (tool == "ToolSearch")
        {
            foreach (var name in nodes.OfType<JsonValue>().Select(node => node.TryGetValue<string>(out var text) ? text : null))
                if (name is { Length: <= 120 } && name.StartsWith("mcp__", StringComparison.Ordinal) && state.DiscoveredTools.Count < 40) state.DiscoveredTools.Add(name);
            state.ProfileDiscovered |= nodes.OfType<JsonValue>().Any(node => node.TryGetValue<string>(out var name) && name is "mcp__claude_ai_Gmail__get_profile" or "mcp__claude_ai_Gmail__get_user_profile");
            return true;
        }
        if (tool.StartsWith(Prefix, StringComparison.Ordinal))
        {
            foreach (var body in nodes.OfType<JsonObject>())
            {
                if (body["mailboxBlocked"] is JsonValue blocked && blocked.TryGetValue<bool>(out var blockedValue) && blockedValue) state.Blocked = true;
                if (body["mailbox"] is JsonObject mailbox && Text(mailbox, "email") == state.Snapshot!.Email && Text(mailbox, "basis") is "user_confirmed" or "provider_verified") state.MailboxConfirmed = true;
                if (body["verificationRequest"] is JsonObject verification)
                {
                    if (!ValidVerification(verification, state.Snapshot!)) { state.Blocked = true; return false; }
                    if (state.Verification is not null && Query(state.Verification) != Query(verification)) { state.Blocked = true; return false; }
                    state.Verification = (JsonObject)verification.DeepClone();
                }
            }
            return !state.Blocked;
        }
        if (tool is "mcp__claude_ai_Gmail__get_profile" or "mcp__claude_ai_Gmail__get_user_profile")
        {
            var emails = nodes.OfType<JsonObject>().SelectMany(node => new[] { Text(node, "emailAddress"), Text(node, "email_address"), Text(node, "email") })
                .Where(value => value is not null).Select(value => value!.Trim().ToLowerInvariant()).Distinct().ToArray();
            state.ProfileVerified = emails.Length == 1 && emails[0] == state.Snapshot!.Email;
            state.Blocked = !state.ProfileVerified;
            if (!state.ProfileVerified)
            {
                state.MailboxFailure = emails.Length == 1 ? "mismatch" : "authorization_failed";
                state.ObservedMailbox = emails.Length == 1 ? emails[0] : null;
            }
            return state.ProfileVerified;
        }
        if (tool == "mcp__claude_ai_Gmail__search_threads")
        {
            foreach (var node in nodes.OfType<JsonObject>())
                foreach (var key in new[] { "id", "messageId", "message_id" })
                    if (Text(node, key) is { Length: > 0 and <= 200 } id && Regex.IsMatch(id, "^[A-Za-z0-9_-]+$") && state.MessageIds.Count < 100) state.MessageIds.Add(id);
        }
        return true;
    }

    internal static string Query(JsonObject request)
    {
        var since = DateTimeOffset.Parse(Text(request, "requestedAt")!, System.Globalization.CultureInfo.InvariantCulture).ToUnixTimeSeconds();
        var senders = ((JsonArray)request["senderDomains"]!).Select(value => "from:" + value!.GetValue<string>());
        return $"deliveredto:\"{Text(request, "email")}\" after:{since} {{{string.Join(' ', senders)}}}";
    }

    private static bool ValidVerification(JsonObject request, AccountSetupSnapshot snapshot) => Text(request, "email") == snapshot.Email
        && Text(request, "tenantOrigin") == snapshot.TenantOrigin && DateTimeOffset.TryParse(Text(request, "requestedAt"), out var since)
        && since <= DateTimeOffset.UtcNow.AddMinutes(1) && since >= DateTimeOffset.UtcNow.AddHours(-24)
        && request["senderDomains"] is JsonArray { Count: >= 1 and <= 10 } senders
        && senders.All(value => value is JsonValue text && text.TryGetValue<string>(out var domain) && domain.Length <= 253 && Regex.IsMatch(domain, "^[a-z0-9]+(?:[.-][a-z0-9]+)*\\.[a-z]{2,}$"));

    private static bool HasError(JsonNode node) => Nodes(node).OfType<JsonObject>().Any(value =>
        value["isError"]?.ToString() == "true" || value["is_error"]?.ToString() == "true" || value["error"] is not null);

    private static IEnumerable<JsonNode> Nodes(JsonNode? node, int depth = 0)
    {
        if (node is null || depth > 12) yield break;
        yield return node;
        if (node is JsonObject obj)
            foreach (var child in obj) foreach (var entry in Nodes(child.Value, depth + 1)) yield return entry;
        else if (node is JsonArray array)
            foreach (var child in array) foreach (var entry in Nodes(child, depth + 1)) yield return entry;
        else if (node is JsonValue value && value.TryGetValue<string>(out var text) && text.TrimStart().StartsWith('{'))
        {
            JsonNode? embedded = null;
            try { embedded = JsonNode.Parse(text); } catch (JsonException) { }
            foreach (var entry in Nodes(embedded, depth + 1)) yield return entry;
        }
    }

    private static string? Text(JsonObject node, string key) => node[key] is JsonValue value && value.TryGetValue<string>(out var text) ? text : null;
}

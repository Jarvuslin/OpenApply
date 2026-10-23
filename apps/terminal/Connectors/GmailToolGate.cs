using System.Text.Json;

namespace OpenApply.Terminal.Connectors;

internal sealed class GmailCheckEvidence
{
    public string? ExpectedEmail { get; set; }
    public string? Mailbox { get; set; }
    public string? ProfileCall { get; set; }
    public string? SearchCall { get; set; }
    public bool ProfileSucceeded { get; set; }
    public bool SearchSucceeded { get; set; }
    public int HookCalls { get; set; }
    public string ProfileResult { get; set; } = "not_called";
    public string SearchResult { get; set; } = "not_called";
    public string? SearchMode { get; set; }
    public bool ThreadSearch { get; set; }
    public List<string> BlockedGmailTools { get; set; } = [];
    public bool GmailToolsDiscovered { get; set; }
    public bool ProfileToolDiscovered { get; set; }
    // A diagnostic run may inspect tool schemas while denying every actual MCP call.
    public bool DiscoveryOnly { get; set; }
    public JsonElement? DiscoveryResponse { get; set; }
}

internal static class GmailToolGate
{
    internal const string Flag = "--gmail-check-hook";
    private const string Denied = "{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"deny\",\"permissionDecisionReason\":\"This check permits only Gmail profile and one bounded job-mail search.\"}}";
    private const string Allowed = "{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"allow\"}}";

    internal static async Task<int> RunAsync(string statePath, string stage, TextReader input, TextWriter output)
    {
        try
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(4));
            var buffer = new char[512 * 1024 + 1];
            var count = 0;
            int read;
            while ((read = await input.ReadAsync(buffer.AsMemory(count), timeout.Token)) > 0)
            {
                count += read;
                if (count == buffer.Length) throw new InvalidDataException("Hook input exceeds its limit.");
            }
            using var hook = JsonDocument.Parse(new string(buffer, 0, count));
            // Exclusive access makes parallel tool calls share the same one-call budget.
            using var file = new FileStream(statePath, FileMode.Open, FileAccess.ReadWrite, FileShare.None);
            if (file.Length > 1024 * 1024) throw new InvalidDataException("Invalid check state.");
            var evidence = JsonSerializer.Deserialize(file, AppJsonContext.Default.GmailCheckEvidence)
                ?? throw new InvalidDataException("Missing check state.");
            var allowed = stage switch
            {
                "pre" => Allow(hook.RootElement, evidence),
                "post" => Observe(hook.RootElement, evidence),
                _ => false,
            };
            file.Position = 0;
            JsonSerializer.Serialize(file, evidence, AppJsonContext.Default.GmailCheckEvidence);
            file.SetLength(file.Position);
            if (stage == "pre") await output.WriteAsync(allowed ? Allowed : Denied);
            else await output.WriteAsync("{}");
            return 0;
        }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException or OperationCanceledException or InvalidDataException or ArgumentException)
        {
            // Exit 2 blocks the tool even when an inherited permission rule would otherwise allow it.
            await output.WriteAsync(Denied);
            return 2;
        }
    }

    internal static bool Allow(JsonElement hook, GmailCheckEvidence evidence)
    {
        if (Text(hook, "hook_event_name") != "PreToolUse") return false;
        evidence.HookCalls += 1;
        var name = Text(hook, "tool_name");
        if (name is "StructuredOutput" or "EndConversation") return true;
        if (!hook.TryGetProperty("tool_input", out var input) || input.ValueKind != JsonValueKind.Object) return false;
        if (name == "ToolSearch")
        {
            var query = Text(input, "query");
            return query is not null && query.Length <= 500 && query.Contains("gmail", StringComparison.OrdinalIgnoreCase);
        }
        var id = Text(hook, "tool_use_id");
        if (string.IsNullOrEmpty(id) || id.Length > 200) return false;
        if (evidence.DiscoveryOnly) return false;
        var kind = Kind(name);
        if (kind == "profile" && evidence.ProfileCall is null && CurrentAccount(input))
        {
            evidence.ProfileCall = id;
            return true;
        }
        var threadSearch = name == "mcp__claude_ai_Gmail__search_threads";
        var verifiedProfile = evidence.ProfileSucceeded && (evidence.ExpectedEmail is null || evidence.ExpectedEmail == evidence.Mailbox);
        var declaredMailbox = threadSearch && evidence.GmailToolsDiscovered && !evidence.ProfileToolDiscovered
            && evidence.ProfileCall is null && GmailCheckProtocol.NormalizeEmail(evidence.ExpectedEmail) is not null;
        var searchQuery = verifiedProfile ? GmailCheckProtocol.SearchQuery : GmailCheckProtocol.DeclaredMailboxQuery(evidence.ExpectedEmail);
        if (kind == "search" && evidence.SearchCall is null && (verifiedProfile || declaredMailbox) && searchQuery is not null
            && (threadSearch ? BoundedThreadSearch(input, searchQuery) : BoundedSearch(input)))
        {
            evidence.SearchCall = id;
            evidence.SearchMode = verifiedProfile ? "verified_profile" : "declared_mailbox";
            evidence.ThreadSearch = threadSearch;
            return true;
        }
        if (name is not null && name.StartsWith("mcp__", StringComparison.Ordinal) && name.Contains("gmail", StringComparison.OrdinalIgnoreCase)
            && name.Length <= 160 && name.All(character => char.IsAsciiLetterOrDigit(character) || character == '_')
            && evidence.BlockedGmailTools.Count < 8 && !evidence.BlockedGmailTools.Contains(name))
            evidence.BlockedGmailTools.Add(name);
        return false;
    }

    internal static bool Observe(JsonElement hook, GmailCheckEvidence evidence)
    {
        if (Text(hook, "hook_event_name") != "PostToolUse" || !hook.TryGetProperty("tool_response", out var response)
            || response.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined) return false;
        if (Text(hook, "tool_name") == "ToolSearch")
        {
            if (response.ValueKind == JsonValueKind.Object && response.TryGetProperty("matches", out var matches)
                && matches.ValueKind == JsonValueKind.Array)
            {
                foreach (var match in matches.EnumerateArray())
                {
                    if (match.ValueKind != JsonValueKind.String) continue;
                    var name = match.GetString();
                    if (name?.StartsWith("mcp__claude_ai_Gmail__", StringComparison.OrdinalIgnoreCase) == true)
                        evidence.GmailToolsDiscovered = true;
                    if (Kind(name) == "profile") evidence.ProfileToolDiscovered = true;
                }
            }
            if (evidence.DiscoveryOnly) evidence.DiscoveryResponse = response.Clone();
            return true;
        }
        var id = Text(hook, "tool_use_id");
        var kind = Kind(Text(hook, "tool_name"));
        if (kind == "profile" && id is not null && id == evidence.ProfileCall)
        {
            if (HasError(response)) { evidence.ProfileResult = "tool_error"; return false; }
            var emails = new HashSet<string>(StringComparer.Ordinal);
            CollectEmails(response, emails, 0);
            if (emails.Count != 1) { evidence.ProfileResult = "unrecognized_response"; return false; }
            evidence.Mailbox = emails.Single();
            evidence.ProfileSucceeded = true;
            evidence.ProfileResult = "success";
            return true;
        }
        if (kind == "search" && id is not null && id == evidence.SearchCall
            && (evidence.ProfileSucceeded || evidence.SearchMode == "declared_mailbox"))
        {
            if (HasError(response)) { evidence.SearchResult = "tool_error"; return false; }
            if (!SearchResult(response, emptyValid: evidence.ThreadSearch)) { evidence.SearchResult = "unrecognized_response"; return false; }
            evidence.SearchSucceeded = true;
            evidence.SearchResult = "success";
            return true;
        }
        return false;
    }

    internal static string? Kind(string? name)
    {
        if (name is null) return null;
        var parts = name.Split("__", StringSplitOptions.None);
        if (parts.Length != 3 || parts[0] != "mcp"
            || !new[] { "claude_ai_Gmail", "gmail" }.Contains(parts[1], StringComparer.OrdinalIgnoreCase)) return null;
        var operation = parts[2].ToLowerInvariant().Replace("gmail_", "", StringComparison.Ordinal);
        return operation switch
        {
            "get_profile" or "get_user_profile" => "profile",
            "search_messages" or "list_messages" or "search_threads" => "search",
            _ => null,
        };
    }

    private static bool CurrentAccount(JsonElement input) => input.EnumerateObject().All(property =>
        property.Name is "userId" or "user_id" && property.Value.ValueKind == JsonValueKind.String && property.Value.GetString() == "me");

    private static bool BoundedThreadSearch(JsonElement input, string query) => input.EnumerateObject().Count() == 3
        && Text(input, "query") == query
        && input.TryGetProperty("pageSize", out var size) && size.ValueKind == JsonValueKind.Number && size.TryGetInt32(out var count) && count == 1
        && Text(input, "view") == "THREAD_VIEW_METADATA_ONLY";

    private static bool BoundedSearch(JsonElement input)
    {
        var query = false;
        var limit = false;
        foreach (var property in input.EnumerateObject())
        {
            if (property.Name is "query" or "q")
            {
                if (query || property.Value.ValueKind != JsonValueKind.String || property.Value.GetString() != GmailCheckProtocol.SearchQuery) return false;
                query = true;
            }
            else if (property.Name is "max_results" or "maxResults" or "limit")
            {
                if (limit || property.Value.ValueKind != JsonValueKind.Number || !property.Value.TryGetInt32(out var size) || size != 1) return false;
                limit = true;
            }
            else if (property.Name is "userId" or "user_id")
            {
                if (property.Value.ValueKind != JsonValueKind.String || property.Value.GetString() != "me") return false;
            }
            else return false;
        }
        return query && limit;
    }

    private static bool HasError(JsonElement element, int depth = 0)
    {
        if (depth > 12) return true;
        if (element.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in element.EnumerateObject())
            {
                if (property.Name is "isError" or "is_error" && property.Value.ValueKind == JsonValueKind.True) return true;
                if (property.Name == "error" && property.Value.ValueKind is not (JsonValueKind.Null or JsonValueKind.False)) return true;
                if (HasError(property.Value, depth + 1)) return true;
            }
        }
        else if (element.ValueKind == JsonValueKind.Array) return element.EnumerateArray().Any(item => HasError(item, depth + 1));
        else if (element.ValueKind == JsonValueKind.String && EmbeddedJson(element) is { } embedded)
        {
            using (embedded) return HasError(embedded.RootElement, depth + 1);
        }
        return false;
    }

    private static void CollectEmails(JsonElement element, HashSet<string> emails, int depth)
    {
        if (depth > 12) return;
        if (element.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in element.EnumerateObject())
            {
                if (property.Name.ToLowerInvariant() is "emailaddress" or "email_address" or "email")
                {
                    if (property.Value.ValueKind == JsonValueKind.String && GmailCheckProtocol.NormalizeEmail(property.Value.GetString()) is { } address)
                        emails.Add(address);
                }
                else CollectEmails(property.Value, emails, depth + 1);
            }
        }
        else if (element.ValueKind == JsonValueKind.Array)
            foreach (var item in element.EnumerateArray()) CollectEmails(item, emails, depth + 1);
        else if (element.ValueKind == JsonValueKind.String && EmbeddedJson(element) is { } embedded)
        {
            using (embedded) CollectEmails(embedded.RootElement, emails, depth + 1);
        }
    }

    private static bool SearchResult(JsonElement element, int depth = 0, bool emptyValid = false, bool checkEmpty = true)
    {
        if (depth > 12) return false;
        if (element.ValueKind == JsonValueKind.Object)
        {
            if (emptyValid && checkEmpty && !element.EnumerateObject().Any()) return true;
            foreach (var property in element.EnumerateObject())
            {
                if (property.Name is "messages" or "threads" or "results" or "emails" or "messageIds"
                    && property.Value.ValueKind == JsonValueKind.Array) return true;
                if (property.Name == "resultSizeEstimate" && property.Value.ValueKind == JsonValueKind.Number
                    && property.Value.TryGetInt32(out var count) && count >= 0) return true;
                if (SearchResult(property.Value, depth + 1, emptyValid, property.Name is "structuredContent" or "structured_content")) return true;
            }
        }
        else if (element.ValueKind == JsonValueKind.Array)
            return element.EnumerateArray().Any(item => SearchResult(item, depth + 1, emptyValid, false));
        else if (element.ValueKind == JsonValueKind.String && EmbeddedJson(element) is { } embedded)
        {
            using (embedded) return SearchResult(embedded.RootElement, depth + 1, emptyValid);
        }
        return false;
    }

    private static JsonDocument? EmbeddedJson(JsonElement element)
    {
        var text = element.GetString()?.Trim();
        if (string.IsNullOrEmpty(text) || text[0] is not ('{' or '[')) return null;
        try { return JsonDocument.Parse(text); }
        catch (JsonException) { return null; }
    }

    private static string? Text(JsonElement element, string name) => element.ValueKind == JsonValueKind.Object
        && element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
}

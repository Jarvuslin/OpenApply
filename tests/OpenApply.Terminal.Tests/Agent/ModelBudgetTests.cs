using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging.Abstractions;
using OpenApply.Terminal.Agent;
using OpenApply.Terminal.Providers;
using Xunit;

namespace OpenApply.Terminal.Tests;

public sealed class ModelBudgetTests
{
    internal static ModelBudget Budget(string path) => new(100, 1_000_000, 10, 30, 40, 10, 60, path);

    [Fact]
    public void AbsentBudgetIsUnboundedAndZeroDeniesEveryProviderWithoutLedger()
    {
        Assert.Null(ModelBudget.Read(_ => null));
        var budget = ModelBudget.Read(key => key == ModelBudget.EnvironmentKey ? "{\"maxRequests\":0}" : null)!;
        Assert.Null(budget.LedgerPath);
        Assert.Throws<ModelBudgetException>(() => budget.ValidateLaunch("claude", null, []));
        Assert.Throws<ModelBudgetException>(() => budget.ValidateLaunch("codex", null, []));
    }

    [Theory]
    [InlineData("")]
    [InlineData("null")]
    [InlineData("{\"maxRequests\":1}")]
    [InlineData("{\"maxRequests\":-1}")]
    [InlineData("{\"maxRequests\":1.5}")]
    [InlineData("{\"maxRequests\":0,\"unexpected\":true}")]
    public void MalformedBudgetNeverFallsBackToUnbounded(string value) => Assert.Throws<ModelBudgetException>(() => ModelBudget.Read(_ => value));

    [Fact]
    public void CompleteBudgetAcceptsZeroWorkersAndFiniteLimits()
    {
        using var temp = new TempDir();
        var budget = ModelBudget.Read(key => key == ModelBudget.LedgerKey ? Path.Combine(temp.Root, "usage.jsonl")
            : "{\"maxRequests\":20,\"maxTokens\":90000,\"maxSubagents\":0,\"maxTurns\":5,\"maxWorkerTurns\":8,\"maxBudgetUsd\":0.5,\"maxSeconds\":30}")!;
        Assert.Equal(0, budget.MaxSubagents);
        Assert.Equal(0.5m, budget.MaxBudgetUsd);
        var args = AgentProcess.Arguments(Provider.Claude, temp.Root, null, NullLogger.Instance, budget);
        Assert.Equal(["--model", "sonnet", "--max-turns", "5", "--max-budget-usd", "0.5", "--setting-sources", ""], args.TakeLast(8));
    }

    [Theory]
    [InlineData("ANTHROPIC_API_KEY")]
    [InlineData("ANTHROPIC_AUTH_TOKEN")]
    [InlineData("ANTHROPIC_BASE_URL")]
    [InlineData("CLAUDE_CODE_OAUTH_TOKEN")]
    [InlineData("CLAUDE_CODE_OAUTH_TOKEN_FILE")]
    [InlineData("CLAUDE_CODE_USE_BEDROCK")]
    [InlineData("CLAUDE_CODE_USE_VERTEX")]
    [InlineData("CLAUDE_CODE_USE_FOUNDRY")]
    public void AlternateBillingRoutesAreRejectedWithoutLeakingValues(string key)
    {
        var budget = Budget("unused");
        var error = Assert.Throws<ModelBudgetException>(() => budget.ValidateLaunch("claude", null, [new(key, "private-secret")]));
        Assert.DoesNotContain("private-secret", error.Message);
        Assert.Throws<ModelBudgetException>(() => budget.ValidateLaunch("codex", null, []));
        Assert.Throws<ModelBudgetException>(() => budget.ValidateLaunch("claude", "previous", []));
    }

    [Theory]
    [InlineData("D:/private-config")]
    [InlineData("")]
    public void CustomAuthenticationDirectoryNeverBypassesStoredApiKeyInspection(string directory)
    {
        var error = Assert.Throws<ModelBudgetException>(() => Budget("unused").ValidateLaunch("claude", null, [new("CLAUDE_CONFIG_DIR", directory)]));
        Assert.Contains("default Claude authentication directory", error.Message);
        Assert.DoesNotContain("private-config", error.Message);
    }

    [Fact]
    public void ExplicitSettingsAndEveryStagedWorkerMustHaveSafeBounds()
    {
        using var temp = new TempDir();
        Directory.CreateDirectory(Path.Combine(temp.Root, "settings"));
        Directory.CreateDirectory(Path.Combine(temp.Root, "agents"));
        var settings = Path.Combine(temp.Root, "settings", "claude.json");
        var worker = Path.Combine(temp.Root, "agents", "worker.md");
        File.WriteAllText(settings, "{\"model\":\"sonnet\"}");
        File.WriteAllText(worker, "---\nname: worker\n---\nBody");
        var budget = Budget("unused");
        Assert.Throws<ModelBudgetException>(() => budget.ValidatePlugin(temp.Root));
        File.WriteAllText(worker, "---\nname: worker\nmaxTurns: 20\n---\nBody");
        budget.ValidatePlugin(temp.Root);
        budget.ValidateSubagent("openapply:worker");
        Assert.Throws<ModelBudgetException>(() => budget.ValidateSubagent("general-purpose"));
        File.WriteAllText(settings, "{\"apiKeyHelper\":\"private-command\"}");
        Assert.Throws<ModelBudgetException>(() => budget.ValidatePlugin(temp.Root));
    }

    [Fact]
    public void ObservedTokenBudgetIncludesAllCacheOccurrences()
    {
        var budget = Budget("unused") with { MaxTokens = 100 };
        Assert.Equal("observed token budget reached", budget.Reached(new(1, new(1, 20, 75, 4), 0)));
        Assert.Equal("observed request budget reached", budget.Reached(new(100, new(), 0)));
        Assert.Null(budget.Reached(new(1, new(), 0)));
        Assert.Equal("subagent-start budget reached", budget.Reached(new(1, new(), 10)));
    }

    [Fact]
    public void SubscriptionMetadataMustBeProOrMaxWithNoStoredApiKey()
    {
        using var temp = new TempDir();
        var credentials = Path.Combine(temp.Root, ".credentials.json");
        var settings = Path.Combine(temp.Root, ".claude.json");
        File.WriteAllText(credentials, "{\"claudeAiOauth\":{\"subscriptionType\":\"pro\",\"accessToken\":\"private-secret\"}}");
        ModelBudget.ValidateSubscription(temp.Root, settings);
        File.WriteAllText(settings, "{\"primaryApiKey\":\"private-api-key\"}");
        var error = Assert.Throws<ModelBudgetException>(() => ModelBudget.ValidateSubscription(temp.Root, settings));
        Assert.DoesNotContain("private", error.Message);
        File.WriteAllText(settings, "{}");
        File.WriteAllText(credentials, "{\"claudeAiOauth\":{\"subscriptionType\":\"free\"}}");
        Assert.Throws<ModelBudgetException>(() => ModelBudget.ValidateSubscription(temp.Root, settings));
    }
}

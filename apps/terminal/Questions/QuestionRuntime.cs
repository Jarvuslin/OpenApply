using OpenApply.Terminal.Agent;

namespace OpenApply.Terminal.Questions;

internal interface IQuestionApi
{
    Task<QuestionSnapshot> ReadAsync(QuestionCollectRequest request, CancellationToken ct);
    Task<QuestionSnapshot> StoreAsync(QuestionCollectRequest request, QuestionStoreRequest observations, CancellationToken ct);
}

internal interface IQuestionBrowser
{
    Task<QuestionObservation> CollectAsync(QuestionBrowserRequest request, CancellationToken ct);
}

internal sealed class QuestionRuntime(IQuestionApi api, IQuestionBrowser browser, AgentRuntimeGate gate)
{
    internal async Task<QuestionCollectResult> CollectAsync(QuestionCollectRequest request, CancellationToken ct)
    {
        if (!gate.TryAcquireQuestions()) throw new InvalidOperationException("The browser is busy. Stop the active queue work or terminal session before collecting questions.");
        var release = true;
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(60));
        try
        {
            var snapshot = await api.ReadAsync(request, timeout.Token);
            if (snapshot.Job.Id != request.JobId) throw new InvalidDataException("The question API returned another job.");
            if (snapshot.CollectionVersion != request.ExpectedCollectionVersion)
                throw new InvalidOperationException("Questions changed. Refresh the job before collecting again.");
            var allowLoopback = Environment.GetEnvironmentVariable("OPENAPPLY_QUESTION_ALLOW_LOOPBACK") == "1";
            if (!QuestionEndpoints.IsCollectionUrl(snapshot.Job.Url, allowLoopback))
                throw new ArgumentException("Code-only collection supports official Greenhouse, Lever and Ashby application URLs.");
            var observation = await browser.CollectAsync(new(snapshot.Job.Url, allowLoopback), timeout.Token);
            Validate(observation);
            if (!QuestionEndpoints.IsSameJobUrl(snapshot.Job.Url, observation.SourceUrl, allowLoopback))
                throw new InvalidDataException("The collected form belongs to a different job URL.");
            var stored = await api.StoreAsync(request, new(request.RequestId, snapshot.CollectionVersion, "browser_dom", observation.SourceUrl,
                observation.Coverage, "openapply-dom-v1", observation.Reason, observation.Definitions), timeout.Token);
            if (stored.Job.Id != request.JobId || stored.LatestCollection is null)
                throw new InvalidDataException("The question API did not return the stored collection.");
            return new(stored.Job.Id, stored.CollectionVersion, stored.LatestCollection.Coverage, stored.Questions.Length, stored.LatestCollection.Reason);
        }
        catch (QuestionBrowserCleanupException) { release = false; throw; }
        finally { if (release) gate.ReleaseQuestions(); }
    }

    internal static void Validate(QuestionObservation observation)
    {
        if (observation.Definitions is null || observation.Definitions.Length > 200 || observation.Coverage is not ("complete" or "partial" or "blocked") || observation.Reason?.Length > 1000)
            throw new InvalidDataException("The question collector exceeded its observation bounds.");
        foreach (var definition in observation.Definitions)
        {
            if (string.IsNullOrWhiteSpace(definition.StableKey) || definition.StableKey.Length > 200 || string.IsNullOrWhiteSpace(definition.Prompt) || definition.Prompt.Length > 4000
                || definition.Description?.Length > 8000 || definition.Fields is null || definition.Fields.Length is < 1 or > 20 || definition.Condition is null
                || definition.Condition.State is not ("unconditional" or "unknown") || definition.Condition.Rules is null || definition.Condition.Rules.Length != 0)
                throw new InvalidDataException("The question collector returned an unsupported definition.");
            foreach (var field in definition.Fields)
                if (string.IsNullOrWhiteSpace(field.Key) || field.Key.Length > 200 || field.Label?.Length > 4000 || field.Options is null || field.Options.Length > 200
                    || field.Options.Any(option => option.Label is null || option.Value is null || option.Label.Length > 2000 || option.Value.Length > 2000))
                    throw new InvalidDataException("The question collector exceeded its field bounds.");
        }
    }
}

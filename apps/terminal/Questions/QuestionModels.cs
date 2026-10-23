using System.Text.Json;
using System.Text.Json.Serialization;

namespace OpenApply.Terminal.Questions;

public sealed record QuestionCollectRequest(string ApiToken, string ApiUrl, string JobId, string RequestId, int ExpectedCollectionVersion);
public sealed record QuestionCollectResult(string JobId, int CollectionVersion, string Coverage, int QuestionCount, string? Reason);
internal sealed record QuestionJob(string Id, string Url);
internal sealed record QuestionCollection(string Coverage, string? Reason);
internal sealed record QuestionSnapshot(QuestionJob Job, int CollectionVersion, QuestionCollection? LatestCollection, JsonElement[] Questions);
internal sealed record QuestionBrowserRequest(string Url, bool AllowLoopback);
internal sealed record QuestionOption(string Value, string Label);
internal sealed record QuestionField(string Key, [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Label, string Type, QuestionOption[] Options);
internal sealed record QuestionCondition(string State, JsonElement[] Rules);
internal sealed record QuestionDefinition(string StableKey, string Prompt, [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Description, string Required, string Visibility, QuestionCondition Condition, string GroupMode, QuestionField[] Fields);
internal sealed record QuestionObservation(QuestionDefinition[] Definitions, string Coverage, string? Reason, string SourceUrl);
internal sealed record QuestionStoreRequest(string RequestId, int ExpectedCollectionVersion, string Source, string SourceUrl, string Coverage, string CollectorVersion, [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Reason, QuestionDefinition[] Definitions);

using System.Text.Json;
using System.Text.Json.Serialization;
using OpenApply.Terminal.Questions;

namespace OpenApply.Terminal.Preparation;

public sealed record PreparationRequest(string ApiToken, string ApiUrl, string JobId, string RequestId, int ExpectedCollectionVersion, string ManifestHash);
internal sealed record PreparationSelection(string Id, string QuestionId, string JobId, string FieldKey, string PdfSha256, int SizeBytes, DateTimeOffset? ConfirmedAt, bool Current, bool Available, string PdfUrl);
internal sealed record PreparationDocumentField(string QuestionId, string FieldKey, string Purpose, PreparationSelection? Selection);
internal sealed record PreparationManifest(QuestionJob Job, int CollectionVersion, string? Coverage, string ManifestHash, string Mode, JsonElement[] Questions, PreparationDocumentField[] DocumentFields, bool SubmissionAllowed);
internal sealed record PreparationDocument(string QuestionId, string FieldKey, string PdfSha256, int SizeBytes, string Base64);
internal sealed record PreparationBrowserRequest(PreparationManifest Manifest, PreparationDocument[] Documents, bool AllowLoopback);
public sealed record PreparationFieldResult(string QuestionId, string FieldKey, string Status,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] JsonElement? Value = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? PdfSha256 = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Reason = null);
internal sealed record PreparationObservation(string SourceUrl, string Status, PreparationFieldResult[] Fields,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Reason);
internal sealed record PreparationStoreRequest(string RequestId, int ExpectedCollectionVersion, string ManifestHash, string Mode, string SourceUrl, string AdapterVersion, string Status, PreparationFieldResult[] Fields,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Reason);
internal sealed record PreparationStored(string Id, string JobId, string RequestId, int CollectionVersion, string ManifestHash, string Mode, string Status, string Verification, bool SubmissionAllowed);
public sealed record PreparationResult(string JobId, int CollectionVersion, string ManifestHash, string Status, PreparationFieldResult[] Fields, string? Reason, string ResultId, string Verification, bool SubmissionAllowed = false, bool ContextRetained = false);

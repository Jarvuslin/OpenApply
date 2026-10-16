using OpenApply.Terminal.Hosting;
using OpenApply.Terminal.Providers;
using OpenApply.Terminal.Questions;

namespace OpenApply.Terminal.Preparation;

internal sealed class PreparationBrowser(HostInstall install) : IPreparationBrowser
{
    public Task<PreparationObservation> FillAsync(PreparationBrowserRequest request, CancellationToken ct)
    {
        var paths = install.RequirePaths();
        var node = ExecutablePath.Find("node") ?? throw new InvalidOperationException("Install the browser runtime before checking preparation.");
        var start = QuestionBrowser.BuildStart(node, paths, "prepare-application.mjs");
        return QuestionBrowser.RunHelperAsync(start, request, AppJsonContext.Default.PreparationBrowserRequest, AppJsonContext.Default.PreparationObservation, ct);
    }
}

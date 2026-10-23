using OpenApply.Terminal.Agent;

namespace OpenApply.Terminal.Hosting;

internal static class BudgetedHost
{
    internal static bool Enabled => Environment.GetEnvironmentVariable(ModelBudget.EnvironmentKey) is not null;

    internal static RequestDelegate RejectOtherEntrypoints(RequestDelegate next, bool enabled) => async context =>
    {
        var path = context.Request.Path;
        if (enabled && new[] { "/inference", "/sessions", "/ws", "/pilot", "/connectors", "/update" }.Any(prefix => path.StartsWithSegments(prefix)))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await context.Response.WriteAsync("This isolated host permits only budgeted queue model execution.", context.RequestAborted);
            return;
        }
        await next(context);
    };
}

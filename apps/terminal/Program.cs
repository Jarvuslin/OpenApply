using OpenApply.Terminal.Hosting;
using OpenApply.Terminal.Inference;
using OpenApply.Terminal.Pilot;
using OpenApply.Terminal.Sessions;
using OpenApply.Terminal.Updates;
using Microsoft.Extensions.Logging.Abstractions;

// Pty.Net's macOS forkpty path requires CoreCLR's W^X remapping to be off; harmless under NativeAOT.
if (OperatingSystem.IsMacOS())
{
    Environment.SetEnvironmentVariable("DOTNET_EnableWriteXorExecute", "0");
}

if (args.Contains("--version", StringComparer.OrdinalIgnoreCase))
{
    Console.WriteLine($"openapply {HostInstall.HostVersion}");
    return;
}

if (args.Contains("--unregister", StringComparer.OrdinalIgnoreCase))
{
    UrlScheme.Unregister(NullLogger.Instance);
    Console.WriteLine("OpenApply: removed the openapply:// URL scheme.");
    return;
}

// appsettings.json sits beside the executable, whatever the launch directory.
var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = UrlScheme.StripSchemeArgs(args),
    ContentRootPath = AppContext.BaseDirectory,
});
builder.Services.AddTerminalHost(builder.Configuration);
var app = builder.Build();

app.Services.GetRequiredService<UrlScheme>().Register();

// A successful startup update launches its replacement before this process binds.
if (await app.Services.GetRequiredService<HostUpdater>().UpdateAtStartupAsync())
{
    return;
}

await HostHandoff.WaitForPreviousHostAsync(app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("Handoff"));

app.UseTerminalPipeline();
app.MapHostEndpoints();
app.MapSessionEndpoints();
app.MapInferenceEndpoints();
app.MapPilotEndpoints();
app.MapUpdateEndpoints();
app.RunWithPortDiagnostics();

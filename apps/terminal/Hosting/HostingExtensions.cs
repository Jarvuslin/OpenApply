using OpenApply.Terminal.Pilot;
using OpenApply.Terminal.Agent;
using OpenApply.Terminal.Queue;
using OpenApply.Terminal.Presence;
using OpenApply.Terminal.Questions;
using OpenApply.Terminal.Preparation;
using OpenApply.Terminal.Sessions;
using OpenApply.Terminal.Updates;
using Microsoft.AspNetCore.Connections;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;

namespace OpenApply.Terminal.Hosting;

public static class HostingExtensions
{
    public static IServiceCollection AddTerminalHost(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddCors(options => options.AddPolicy(
            OriginPolicy.CorsPolicy,
            policy => policy.WithOrigins(OriginPolicy.Resolve(configuration)).AllowAnyHeader().AllowAnyMethod()));

        // One long-lived client for every outbound call. Callers bound their own requests; the pooled lifetime
        // lets a host that runs for weeks follow DNS changes.
        services.AddSingleton(_ => new HttpClient(new SocketsHttpHandler { PooledConnectionLifetime = TimeSpan.FromMinutes(15) })
        {
            Timeout = Timeout.InfiniteTimeSpan,
        });

        services.AddSingleton<HostInstall>();
        services.AddSingleton<HostStatus>();
        services.AddSingleton<UrlScheme>();

        services.AddSingleton<ScratchCleaner>();
        if (!BudgetedHost.Enabled) services.AddHostedService(sp => sp.GetRequiredService<ScratchCleaner>());
        services.AddSingleton<TerminalSession>();
        services.AddSingleton<TerminalRelay>();
        services.AddSingleton<AgentRuntimeGate>();
        services.AddSingleton<IQueueApi>(_ => new QueueApi(new HttpClient(new SocketsHttpHandler { AllowAutoRedirect = false, PooledConnectionLifetime = TimeSpan.FromMinutes(15) }) { Timeout = Timeout.InfiniteTimeSpan }));
        services.AddSingleton<IAgentProcess, AgentProcess>();
        services.AddSingleton<IQueueBrowser, QueueBrowser>();
        services.AddSingleton<QueueRuntime>();
        services.AddHostedService(sp => sp.GetRequiredService<QueueRuntime>());
        services.AddSingleton<IRuntimePresenceSource>(sp => sp.GetRequiredService<QueueRuntime>());
        services.AddSingleton(sp => new RuntimePresence(new HttpClient(new SocketsHttpHandler { AllowAutoRedirect = false, PooledConnectionLifetime = TimeSpan.FromMinutes(15) }) { Timeout = Timeout.InfiniteTimeSpan }, sp.GetRequiredService<IRuntimePresenceSource>()));
        services.AddHostedService(sp => sp.GetRequiredService<RuntimePresence>());
        services.AddSingleton<IQuestionApi, QuestionApi>();
        services.AddSingleton<IQuestionBrowser, QuestionBrowser>();
        services.AddSingleton<QuestionRuntime>();
        services.AddSingleton<IPreparationApi>(_ => new PreparationApi(new HttpClient(new SocketsHttpHandler { AllowAutoRedirect = false, PooledConnectionLifetime = TimeSpan.FromMinutes(15) }) { Timeout = Timeout.InfiniteTimeSpan }));
        services.AddSingleton<IPreparationBrowser, PreparationBrowser>();
        services.AddSingleton<PreparationRuntime>();

        services.AddSingleton(sp => new PilotStore(
            PilotStore.ResolvePath(sp.GetRequiredService<HostInstall>()),
            sp.GetRequiredService<ILogger<PilotStore>>()));
        services.AddSingleton<PilotApi>();
        services.AddSingleton<IPilotScheduler>(sp => sp.GetRequiredService<PilotApi>());
        services.AddSingleton<PilotLoop>();
        if (!BudgetedHost.Enabled)
        {
            services.AddHostedService(sp => sp.GetRequiredService<PilotLoop>());
            services.AddHostedService(sp => new PilotEventListener(
                sp.GetRequiredService<PilotStore>(),
                sp.GetRequiredService<PilotApi>(),
                sp.GetRequiredService<PilotLoop>().Wake,
                sp.GetRequiredService<ILogger<PilotEventListener>>()));
        }

        services.AddSingleton<HostUpdater>();

        services.ConfigureHttpJsonOptions(c => c.SerializerOptions.TypeInfoResolverChain.Insert(0, AppJsonContext.Default));

        // Production otherwise answers a binding failure with an empty 400, and the web expects ProblemDetails.
        services.Configure<RouteHandlerOptions>(o => o.ThrowOnBadRequest = true);

        // Must stay below HostHandoff.MaxWait, or an update's relaunched host times out and fails to bind.
        services.Configure<HostOptions>(o => o.ShutdownTimeout = TimeSpan.FromSeconds(5));

        return services;
    }

    public static WebApplication UseTerminalPipeline(this WebApplication app)
    {
        app.UseExceptionHandler(errorApp => errorApp.Run(async context =>
        {
            var error = context.Features.Get<IExceptionHandlerFeature>()?.Error;
            var status = error switch
            {
                BadHttpRequestException bad => bad.StatusCode,
                ArgumentException => StatusCodes.Status400BadRequest,
                _ => StatusCodes.Status500InternalServerError,
            };

            context.Response.StatusCode = status;
            context.Response.ContentType = "application/problem+json";
            var problem = new ProblemDetails
            {
                Title = status == StatusCodes.Status500InternalServerError ? "Terminal host error" : "Invalid request",
                Detail = error?.Message,
                Status = status,
            };
            await context.Response.WriteAsJsonAsync(problem, AppJsonContext.Default.ProblemDetails);
        }));

        app.Use(next => OriginPolicy.RejectOtherOrigins(app.Configuration, next));
        app.Use(next => BudgetedHost.RejectOtherEntrypoints(next, BudgetedHost.Enabled));
        app.UseCors(OriginPolicy.CorsPolicy);
        app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(30) });

        // Created before the first /ws request, so output from before a browser connects still reaches its replay.
        var relay = app.Services.GetRequiredService<TerminalRelay>();
        app.Lifetime.ApplicationStopping.Register(() =>
        {
            app.Services.GetRequiredService<TerminalSession>().Stop();
            // An open socket otherwise holds Kestrel's graceful stop for the whole shutdown timeout.
            relay.AbortAll();
        });

        return app;
    }

    public static void RunWithPortDiagnostics(this WebApplication app)
    {
        try
        {
            app.Run();
        }
        catch (IOException ex) when (ex.InnerException is AddressInUseException)
        {
            var url = app.Configuration["Kestrel:Endpoints:Http:Url"] ?? "http://localhost:4102";
            Console.Error.WriteLine(
                $"OpenApply terminal: {url} is already in use - another openapply instance is probably running.\n"
                + "Stop it and retry: 'Get-Process openapply | Stop-Process' (Windows) or 'pkill -x openapply' (macOS/Linux).");
            Environment.Exit(1);
        }
    }
}

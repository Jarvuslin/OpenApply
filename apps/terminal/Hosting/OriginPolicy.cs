namespace JobPilot.Terminal.Hosting;

/// <summary>
/// Browser origins allowed to control the local terminal host. Because CORS only controls access to a
/// response, <see cref="CreateGuard"/> also rejects disallowed requests before they reach an endpoint.
/// Requests without an Origin header remain available to local command-line tools.
/// </summary>
public static class OriginPolicy
{
    public const string CorsPolicy = "jobpilot-web";

    private const string ConfigKey = "Terminal:AllowedOrigins";

    private static readonly string[] Defaults =
    [
        "http://localhost:4100",
        "http://127.0.0.1:4100",
        "https://jobpilot.suxrobgm.net",
    ];

    /// <summary>Returns configured origins or the development and hosted defaults.</summary>
    public static string[] Resolve(IConfiguration configuration)
    {
        // Avoid reflection-based configuration binding under Native AOT.
        string[] configured =
        [
            .. configuration.GetSection(ConfigKey).GetChildren()
                .Select(child => child.Value)
                .Where(value => !string.IsNullOrWhiteSpace(value))
                .Select(value => value!),
        ];

        var origins = configured.Length > 0 ? configured : Defaults;

        return [.. origins.Select(o => o.TrimEnd('/')).Distinct(StringComparer.OrdinalIgnoreCase)];
    }

    /// <summary>Creates middleware that rejects browser requests from outside the allowlist.</summary>
    internal static RequestDelegate CreateGuard(IConfiguration configuration, RequestDelegate next)
    {
        var allowedOrigins = Resolve(configuration).ToHashSet(StringComparer.OrdinalIgnoreCase);

        return async context =>
        {
            var origin = context.Request.Headers.Origin.ToString();
            if (origin.Length > 0 && !allowedOrigins.Contains(origin))
            {
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                return;
            }

            await next(context);
        };
    }
}

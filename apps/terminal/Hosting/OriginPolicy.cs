namespace JobPilot.Terminal.Hosting;

/// <summary>
/// Browser origins allowed to control the host, from <c>Terminal:AllowedOrigins</c> in appsettings.json.
/// Requests without an Origin header stay open to local command-line tools.
/// </summary>
public static class OriginPolicy
{
    public const string CorsPolicy = "jobpilot-web";

    private const string ConfigKey = "Terminal:AllowedOrigins";

    public static string[] Resolve(IConfiguration configuration) =>
    [
        // Read the children directly: reflection-based configuration binding breaks under Native AOT.
        .. configuration.GetSection(ConfigKey).GetChildren()
            .Select(child => child.Value)
            .OfType<string>()
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value.TrimEnd('/'))
            .Distinct(StringComparer.OrdinalIgnoreCase),
    ];

    /// <summary>
    /// CORS only hides a response; it does not stop a simple request such as POST /update from running. This
    /// rejects a foreign origin before any endpoint, WebSocket handshakes included.
    /// </summary>
    internal static RequestDelegate RejectOtherOrigins(IConfiguration configuration, RequestDelegate next)
    {
        var allowed = Resolve(configuration).ToHashSet(StringComparer.OrdinalIgnoreCase);
        return async context =>
        {
            var origin = context.Request.Headers.Origin.ToString();
            if (origin.Length > 0 && !allowed.Contains(origin))
            {
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                return;
            }

            await next(context);
        };
    }
}

using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using OpenApply.Terminal.Agent;

namespace OpenApply.Terminal.Queue;

internal sealed class QueuePluginStage
{
    internal string PluginDir { get; }
    internal string SourceHash { get; }
    private readonly string snapshotHash;

    private QueuePluginStage(string path, string sourceHash, string snapshotHash)
    { PluginDir = path; SourceHash = sourceHash; this.snapshotHash = snapshotHash; }

    internal static QueuePluginStage Create(string source, string stagingRoot, ModelBudget budget)
    {
        var files = ReadTree(source);
        var sourceHash = Hash(files);
        var destination = Path.Combine(stagingRoot, Guid.NewGuid().ToString("D"), "plugin");
        foreach (var (name, original) in files.ToArray())
        {
            var bytes = original;
            if (name.StartsWith("agents/", StringComparison.Ordinal) && name.EndsWith(".md", StringComparison.OrdinalIgnoreCase))
            {
                string text;
                try { text = new UTF8Encoding(false, true).GetString(original); }
                catch (DecoderFallbackException) { throw new ModelBudgetException("Queue plugin contains invalid agent text."); }
                var header = Regex.Match(text, @"\A---\r?\n(?<header>[\s\S]*?)\r?\n---(?:\r?\n|\z)");
                if (!header.Success) throw new ModelBudgetException("Queue plugin contains an invalid agent header.");
                var fields = Regex.Matches(header.Groups["header"].Value, @"(?m)^[ \t]*maxTurns[ \t]*:.*$");
                var limit = budget.MaxWorkerTurns;
                if (fields.Count > 1) throw new ModelBudgetException("Queue plugin contains duplicate agent limits.");
                if (fields.Count == 1)
                {
                    var value = Regex.Match(fields[0].Value, @"^maxTurns:[ \t]*(\d+)[ \t]*\r?$");
                    if (!value.Success || !int.TryParse(value.Groups[1].Value, out var existing) || existing <= 0)
                        throw new ModelBudgetException("Queue plugin contains an invalid agent limit.");
                    limit = Math.Min(limit, existing);
                }
                var capped = fields.Count == 0 ? header.Groups["header"].Value + $"\nmaxTurns: {limit}"
                    : header.Groups["header"].Value.Replace(fields[0].Value, $"maxTurns: {limit}", StringComparison.Ordinal);
                text = text[..header.Groups["header"].Index] + capped + text[(header.Groups["header"].Index + header.Groups["header"].Length)..];
                bytes = Encoding.UTF8.GetBytes(text);
            }
            var target = Path.Combine(destination, name.Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            using (var output = new FileStream(target, FileMode.CreateNew, FileAccess.Write)) output.Write(bytes);
            if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(target, File.GetUnixFileMode(Path.Combine(source, name)));
            files[name] = bytes;
        }
        if (sourceHash != Hash(ReadTree(source))) throw new ModelBudgetException("Queue plugin changed during staging.");
        budget.ValidatePlugin(destination);
        return new(destination, sourceHash, Hash(files));
    }

    internal void Verify(ModelBudget budget)
    {
        if (Hash(ReadTree(PluginDir)) != snapshotHash) throw new ModelBudgetException("The staged queue plugin changed; no model may start.");
        budget.ValidatePlugin(PluginDir);
    }

    private static SortedDictionary<string, byte[]> ReadTree(string root)
    {
        var result = new SortedDictionary<string, byte[]>(StringComparer.Ordinal);
        var pending = new Stack<string>(); pending.Push(Path.GetFullPath(root));
        long total = 0;
        while (pending.TryPop(out var directory))
        {
            if ((File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0) throw new ModelBudgetException("Queue plugin links are not permitted.");
            foreach (var path in Directory.EnumerateFileSystemEntries(directory))
            {
                var attributes = File.GetAttributes(path);
                if ((attributes & FileAttributes.ReparsePoint) != 0) throw new ModelBudgetException("Queue plugin links are not permitted.");
                if ((attributes & FileAttributes.Directory) != 0) { pending.Push(path); continue; }
                using var input = File.OpenRead(path);
                if (input.Length > 2_000_000 || result.Count >= 2000 || (total += input.Length) > 16_000_000)
                    throw new ModelBudgetException("Queue plugin exceeds its staging bounds.");
                var bytes = new byte[checked((int)input.Length)]; input.ReadExactly(bytes);
                if (input.ReadByte() != -1) throw new ModelBudgetException("Queue plugin changed during staging.");
                result.Add(Path.GetRelativePath(root, path).Replace('\\', '/'), bytes);
            }
        }
        return result;
    }

    private static string Hash(SortedDictionary<string, byte[]> files)
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        foreach (var (name, bytes) in files)
        {
            hash.AppendData(Encoding.UTF8.GetBytes(name + "\0"));
            hash.AppendData(SHA256.HashData(bytes));
        }
        return Convert.ToHexStringLower(hash.GetHashAndReset());
    }
}

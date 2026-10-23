using OpenApply.Terminal.Queue;
using Xunit;

namespace OpenApply.Terminal.Tests;

public sealed class QueueFramePolicyTests
{
    [Fact]
    public void FramesRejectStaleOversizedMalformedAndCrossWorkerImages()
    {
        var frame = new QueueFrame("work", "execution", "browser", DateTimeOffset.UtcNow, "image/jpeg", "/9j/2Q==", 1280, 720);
        void Check(QueueFrame value) => QueueRuntime.ValidateFrame(value, "work", "execution", "browser");
        Check(frame);
        foreach (var invalid in new[]{frame with {CapturedAt=DateTimeOffset.UtcNow.AddSeconds(-6)},frame with {CapturedAt=DateTimeOffset.UtcNow.AddMinutes(1)},
            frame with {ExecutionId="other"},frame with {BrowserSessionId="other"},frame with {Width=1921},frame with {Height=1081},
            frame with {MimeType="image/svg+xml"},frame with {ImageBase64="invalid"},frame with {ImageBase64=new('a',853337)}})
            Assert.Throws<InvalidDataException>(() => Check(invalid));
    }

    [Fact]
    public void ObservationRequiresCurrentAccountAndUnexpiredExactLiveLease()
    {
        var observer = new QueueObserver("owner", "work", "execution", "browser", "filling", DateTimeOffset.UtcNow.AddSeconds(10), true, "execution");
        void Check(QueueObserver value) => QueueRuntime.ValidateObserver(value, "owner", "work", "execution", "browser");
        Check(observer);
        foreach (var invalid in new[]{observer with {OwnerId="foreign"},observer with {WorkItemId="foreign"},observer with {ExecutionId="old"},
            observer with {BrowserSessionId="other"},observer with {State="paused"},observer with {Active=false},observer with {LeaseExpiresAt=DateTimeOffset.UtcNow.AddSeconds(-1)}})
            Assert.Throws<InvalidOperationException>(() => Check(invalid));
    }
}

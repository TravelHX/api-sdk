using global::ApiSdk;

namespace ApiSdk.Tests;

public class ApiSdkTests
{
    [Fact]
    public void Should_Create_Instance()
    {
        var sdk = new ApiSdk();
        Assert.NotNull(sdk);
    }
}

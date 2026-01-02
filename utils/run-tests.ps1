# Run test harness for both .NET and Node.js
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "Running Test Harness" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow
Write-Host ""

$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootPath = Join-Path $scriptPath ".."
$dotnetTestPath = Join-Path $rootPath "test\dotnet\ApiSdk.Tests\ApiSdk.Tests.csproj"
$jsTestPath = Join-Path $rootPath "test\js"

$exitCode = 0

# .NET Tests
Write-Host "----------------------------------------" -ForegroundColor Yellow
Write-Host ".NET Tests (xUnit)" -ForegroundColor Yellow
Write-Host "----------------------------------------" -ForegroundColor Yellow
Write-Host ""

Push-Location $rootPath
# Use -m:1 to avoid Add-Content file locking issues in PowerShell 5.1
dotnet test $dotnetTestPath --verbosity normal -m:1
$dotnetExitCode = $LASTEXITCODE
Pop-Location

if ($dotnetExitCode -ne 0) {
    Write-Host ""
    Write-Host ".NET tests failed!" -ForegroundColor Red
    $exitCode = 1
} else {
    Write-Host ""
    Write-Host ".NET tests passed!" -ForegroundColor Green
}

Write-Host ""

# JavaScript Tests
Write-Host "----------------------------------------" -ForegroundColor Yellow
Write-Host "JavaScript Tests (Jest)" -ForegroundColor Yellow
Write-Host "----------------------------------------" -ForegroundColor Yellow
Write-Host ""

Push-Location $jsTestPath
npm test
$jsExitCode = $LASTEXITCODE
Pop-Location

if ($jsExitCode -ne 0) {
    Write-Host ""
    Write-Host "JavaScript tests failed!" -ForegroundColor Red
    $exitCode = 1
} else {
    Write-Host ""
    Write-Host "JavaScript tests passed!" -ForegroundColor Green
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Yellow
if ($exitCode -eq 0) {
    Write-Host "All tests passed!" -ForegroundColor Green
} else {
    Write-Host "Some tests failed!" -ForegroundColor Red
}
Write-Host "========================================" -ForegroundColor Yellow
Write-Host ""

exit $exitCode




# Build and run .NET SDK Validator
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootPath = Join-Path $scriptPath "..\.."
$sdkPath = Join-Path $rootPath "src\dotnet\ApiSdk\ApiSdk.csproj"
$validatorPath = Join-Path $scriptPath "ApiSdk.Validator\ApiSdk.Validator.csproj"

# Stop any lingering MSBuild processes that might hold file locks
Write-Host "Preparing build environment..." -ForegroundColor Cyan
Get-Process -Name "MSBuild" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

# Set environment to minimize node reuse
$env:MSBUILDDISABLENODEREUSE = "1"

Write-Host "Building .NET SDK..." -ForegroundColor Cyan
# Use -m:1 to avoid Add-Content file locking issues in PowerShell 5.1
# Filter out Add-Content errors which are non-fatal
$output = dotnet build $sdkPath -m:1 2>&1 | Where-Object {
    $_ -notmatch "Add-Content.*Stream was not readable" -and
    $_ -notmatch "GetContentWriterArgumentError" -and
    $_ -notmatch "GetContentWriterIOError"
}
$output | Write-Host

# Check if build actually succeeded
$outputString = $output -join "`n"
if ($LASTEXITCODE -ne 0 -and $outputString -notmatch "Build succeeded") {
    Write-Host "SDK build failed!" -ForegroundColor Red
    Remove-Item Env:\MSBUILDDISABLENODEREUSE -ErrorAction SilentlyContinue
    exit 1
}

Write-Host "Building .NET Validator..." -ForegroundColor Cyan
# Use -m:1 to avoid Add-Content file locking issues in PowerShell 5.1
$output = dotnet build $validatorPath -m:1 2>&1 | Where-Object {
    $_ -notmatch "Add-Content.*Stream was not readable" -and
    $_ -notmatch "GetContentWriterArgumentError" -and
    $_ -notmatch "GetContentWriterIOError"
}
$output | Write-Host

# Check if build actually succeeded
$outputString = $output -join "`n"
if ($LASTEXITCODE -ne 0 -and $outputString -notmatch "Build succeeded") {
    Write-Host "Validator build failed!" -ForegroundColor Red
    Remove-Item Env:\MSBUILDDISABLENODEREUSE -ErrorAction SilentlyContinue
    exit 1
}

Remove-Item Env:\MSBUILDDISABLENODEREUSE -ErrorAction SilentlyContinue

Write-Host "Running .NET Validator..." -ForegroundColor Cyan
dotnet run --project $validatorPath

exit $LASTEXITCODE


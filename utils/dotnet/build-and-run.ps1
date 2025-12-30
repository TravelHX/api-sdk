# Build and run .NET SDK Validator
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootPath = Join-Path $scriptPath "..\.."
$sdkPath = Join-Path $rootPath "src\dotnet\ApiSdk\ApiSdk.csproj"
$validatorPath = Join-Path $scriptPath "ApiSdk.Validator\ApiSdk.Validator.csproj"

Write-Host "Building .NET SDK..." -ForegroundColor Cyan
dotnet build $sdkPath

if ($LASTEXITCODE -ne 0) {
    Write-Host "SDK build failed!" -ForegroundColor Red
    exit 1
}

Write-Host "Building .NET Validator..." -ForegroundColor Cyan
dotnet build $validatorPath

if ($LASTEXITCODE -ne 0) {
    Write-Host "Validator build failed!" -ForegroundColor Red
    exit 1
}

Write-Host "Running .NET Validator..." -ForegroundColor Cyan
dotnet run --project $validatorPath

exit $LASTEXITCODE


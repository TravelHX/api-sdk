# PowerShell script to manage Docker build and run for API SDK Test Runner
# This script:
# 1. Completely tears down the docker build
# 2. Creates a new docker build (both .NET and Node.js inside)
# 3. Runs the interactive console app

param(
    [string]$Platform = "dotnet",
    [switch]$NoCache
)

$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootPath = Join-Path $scriptPath ".."
$imageName = "api-sdk-testrunner"
$containerName = "api-sdk-testrunner-container"

Write-Host "========================================" -ForegroundColor Yellow
Write-Host "API SDK Docker Test Runner" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow
Write-Host ""

# Step 1: Tear down existing Docker build
Write-Host "Step 1: Tearing down existing Docker build..." -ForegroundColor Cyan
Write-Host ""

# Stop and remove container if it exists
Write-Host "  Stopping container (if running)..." -ForegroundColor Gray
docker stop $containerName 2>$null | Out-Null
docker rm $containerName 2>$null | Out-Null

# Remove image if it exists
Write-Host "  Removing image (if exists)..." -ForegroundColor Gray
docker rmi $imageName 2>$null | Out-Null

# Remove dangling images
Write-Host "  Cleaning up dangling images..." -ForegroundColor Gray
docker image prune -f 2>$null | Out-Null

Write-Host "  Tear down complete!" -ForegroundColor Green
Write-Host ""

# Step 2: Create new Docker build
Write-Host "Step 2: Building new Docker image..." -ForegroundColor Cyan
Write-Host ""

Push-Location $rootPath

$buildArgs = @()
if ($NoCache) {
    $buildArgs += "--no-cache"
}

$buildCommand = "docker build -t $imageName $($buildArgs -join ' ') ."
Write-Host "  Running: $buildCommand" -ForegroundColor Gray
Write-Host ""

# Use & operator instead of Invoke-Expression for better error handling
# Build the argument array properly
$dockerArgs = @("build", "-t", $imageName)
if ($buildArgs.Count -gt 0) {
    $dockerArgs += $buildArgs
}
$dockerArgs += "."

& docker $dockerArgs
$buildExitCode = $LASTEXITCODE

Pop-Location

if ($buildExitCode -ne 0) {
    Write-Host ""
    Write-Host "Docker build FAILED with exit code: $buildExitCode" -ForegroundColor Red
    Write-Host "Please check the build output above for errors." -ForegroundColor Red
    exit $buildExitCode
}

Write-Host "  Docker build complete!" -ForegroundColor Green
Write-Host ""

# Step 3: Run the interactive console app
Write-Host "Step 3: Running interactive console app..." -ForegroundColor Cyan
Write-Host ""

# Determine entrypoint based on platform
$entrypoint = ""
$command = ""

if ($Platform -eq "node" -or $Platform -eq "js") {
    Write-Host "  Platform: Node.js" -ForegroundColor Gray
    $entrypoint = "node"
    $command = "/app/js-testrunner/test-runner.js"
} else {
    Write-Host "  Platform: .NET" -ForegroundColor Gray
    $entrypoint = "dotnet"
    $command = "/app/dotnet-testrunner/ApiSdk.TestRunner.dll"
}

Write-Host ""
Write-Host "  Starting container: $containerName" -ForegroundColor Gray
Write-Host "  Image: $imageName" -ForegroundColor Gray
Write-Host ""

# Run container interactively
# Use -i instead of -it on Windows PowerShell to avoid TTY issues
docker run -i --rm `
    --name $containerName `
    --entrypoint $entrypoint `
    -v "${rootPath}/data:/app/data:ro" `
    -v "${rootPath}/config.json:/app/config.json:ro" `
    $imageName `
    $command

$runExitCode = $LASTEXITCODE

Write-Host ""
if ($runExitCode -eq 0) {
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "Test runner completed successfully!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
} else {
    Write-Host "========================================" -ForegroundColor Red
    Write-Host "Test runner exited with code: $runExitCode" -ForegroundColor Red
    Write-Host "========================================" -ForegroundColor Red
}

exit $runExitCode


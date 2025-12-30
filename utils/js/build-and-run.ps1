# Build and run JavaScript SDK Validator
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootPath = Join-Path $scriptPath "..\.."
$sdkPath = Join-Path $rootPath "src\js"
$validatorPath = $scriptPath

Write-Host "Building JavaScript SDK..." -ForegroundColor Cyan
Push-Location $sdkPath
npm run build
$buildExitCode = $LASTEXITCODE
Pop-Location

if ($buildExitCode -ne 0) {
    Write-Host "SDK build failed!" -ForegroundColor Red
    exit 1
}

Write-Host "Running JavaScript Validator..." -ForegroundColor Cyan
Push-Location $validatorPath
node index.js
$runExitCode = $LASTEXITCODE
Pop-Location

exit $runExitCode


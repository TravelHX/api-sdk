# Build and run all validators
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "Building and Running All Validators" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow
Write-Host ""

$exitCode = 0

# .NET Validator
Write-Host "----------------------------------------" -ForegroundColor Yellow
Write-Host ".NET Validator" -ForegroundColor Yellow
Write-Host "----------------------------------------" -ForegroundColor Yellow
& "$PSScriptRoot\dotnet\build-and-run.ps1"
if ($LASTEXITCODE -ne 0) {
    $exitCode = 1
}

Write-Host ""

# JavaScript Validator
Write-Host "----------------------------------------" -ForegroundColor Yellow
Write-Host "JavaScript Validator" -ForegroundColor Yellow
Write-Host "----------------------------------------" -ForegroundColor Yellow
& "$PSScriptRoot\js\build-and-run.ps1"
if ($LASTEXITCODE -ne 0) {
    $exitCode = 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Yellow
if ($exitCode -eq 0) {
    Write-Host "All validators passed!" -ForegroundColor Green
} else {
    Write-Host "Some validators failed!" -ForegroundColor Red
}
Write-Host "========================================" -ForegroundColor Yellow

exit $exitCode


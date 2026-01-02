# Safe build script that works around Add-Content file locking issues
# This script cleans temp files and builds with single-threaded mode to avoid file locking

param(
    [string]$ProjectPath = "",
    [switch]$Clean
)

$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootPath = Join-Path $scriptPath "..\.."

Write-Host "Cleaning temporary PowerShell scripts..." -ForegroundColor Cyan
# Clean any leftover temp PowerShell scripts that might be locked
Get-ChildItem -Path "$env:LOCALAPPDATA\Temp" -Filter "ps-script-*.ps1" -ErrorAction SilentlyContinue | 
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddMinutes(-5) } | 
    Remove-Item -Force -ErrorAction SilentlyContinue

Get-ChildItem -Path "$env:LOCALAPPDATA\Temp" -Filter "*.txt" -ErrorAction SilentlyContinue | 
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddMinutes(-5) -and $_.Name -match "^[a-f0-9]{32}\.txt$" } | 
    Remove-Item -Force -ErrorAction SilentlyContinue

if ($Clean) {
    Write-Host "Cleaning build artifacts..." -ForegroundColor Cyan
    if ($ProjectPath -ne "") {
        dotnet clean $ProjectPath -m:1
    } else {
        Get-ChildItem -Path $rootPath -Recurse -Filter "*.csproj" | ForEach-Object {
            Write-Host "Cleaning $($_.FullName)..." -ForegroundColor Gray
            dotnet clean $_.FullName -m:1 2>&1 | Out-Null
        }
    }
}

Write-Host "Building with single-threaded mode (workaround for Add-Content issue)..." -ForegroundColor Cyan
if ($ProjectPath -ne "") {
    dotnet build $ProjectPath -m:1 --no-incremental
} else {
    Get-ChildItem -Path $rootPath -Recurse -Filter "*.csproj" | ForEach-Object {
        Write-Host "Building $($_.FullName)..." -ForegroundColor Gray
        dotnet build $_.FullName -m:1 --no-incremental
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Build failed for $($_.FullName)" -ForegroundColor Red
            exit $LASTEXITCODE
        }
    }
}

if ($LASTEXITCODE -eq 0) {
    Write-Host "Build completed successfully!" -ForegroundColor Green
} else {
    Write-Host "Build failed!" -ForegroundColor Red
}

exit $LASTEXITCODE


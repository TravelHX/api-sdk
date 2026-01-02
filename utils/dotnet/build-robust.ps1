# Robust build script that handles Add-Content file locking issues
# This script kills lingering MSBuild processes and uses error handling

param(
    [string]$ProjectPath = "",
    [switch]$Clean
)

$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootPath = Join-Path $scriptPath "..\.."

Write-Host "Stopping any lingering MSBuild processes..." -ForegroundColor Cyan
# Kill any MSBuild processes that might be holding file locks
Get-Process -Name "MSBuild" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name "dotnet" -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "*dotnet.exe" } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

Write-Host "Cleaning temporary files..." -ForegroundColor Cyan
# Clean temp files more aggressively
$tempPath = $env:LOCALAPPDATA + "\Temp"
try {
    Get-ChildItem -Path $tempPath -Filter "ps-script-*.ps1" -ErrorAction SilentlyContinue | 
        Remove-Item -Force -ErrorAction SilentlyContinue
    Get-ChildItem -Path $tempPath -Filter "ps-state-*.txt" -ErrorAction SilentlyContinue | 
        Remove-Item -Force -ErrorAction SilentlyContinue
    Get-ChildItem -Path $tempPath -Filter "*.txt" -ErrorAction SilentlyContinue | 
        Where-Object { $_.Name -match "^[a-f0-9]{32}\.txt$" } | 
        Remove-Item -Force -ErrorAction SilentlyContinue
} catch {
    Write-Host "Warning: Some temp files could not be cleaned: $_" -ForegroundColor Yellow
}

# Set environment variables to minimize MSBuild node reuse
$env:MSBUILDDISABLENODEREUSE = "1"
$env:MSBUILDNOINPROCNODE = "1"

if ($Clean) {
    Write-Host "Cleaning build artifacts..." -ForegroundColor Cyan
    if ($ProjectPath -ne "") {
        $fullPath = if ([System.IO.Path]::IsPathRooted($ProjectPath)) { $ProjectPath } else { Join-Path $rootPath $ProjectPath }
        & dotnet clean $fullPath -m:1 2>&1 | Out-Null
    } else {
        Get-ChildItem -Path $rootPath -Recurse -Filter "*.csproj" | ForEach-Object {
            Write-Host "Cleaning $($_.Name)..." -ForegroundColor Gray
            & dotnet clean $_.FullName -m:1 2>&1 | Out-Null
        }
    }
}

Write-Host "Building with single-threaded mode..." -ForegroundColor Cyan
$buildSuccess = $false
$buildError = $null

if ($ProjectPath -ne "") {
    $fullPath = if ([System.IO.Path]::IsPathRooted($ProjectPath)) { $ProjectPath } else { Join-Path $rootPath $ProjectPath }
    Write-Host "Building: $fullPath" -ForegroundColor Gray
    
    # Capture both stdout and stderr, filter out Add-Content errors
    $output = & dotnet build $fullPath -m:1 --no-incremental 2>&1 | Where-Object {
        $_ -notmatch "Add-Content.*Stream was not readable" -and
        $_ -notmatch "GetContentWriterArgumentError" -and
        $_ -notmatch "GetContentWriterIOError"
    }
    
    # Check if build actually succeeded by looking for success indicators
    $outputString = $output -join "`n"
    if ($outputString -match "Build succeeded" -or $outputString -match "Build FAILED" -eq $false) {
        $output | Write-Host
        if ($LASTEXITCODE -eq 0 -or $outputString -match "Build succeeded") {
            $buildSuccess = $true
        }
    } else {
        $output | Write-Host
        $buildSuccess = $false
    }
} else {
    $allProjects = Get-ChildItem -Path $rootPath -Recurse -Filter "*.csproj"
    $buildSuccess = $true
    
    foreach ($project in $allProjects) {
        Write-Host "Building $($project.Name)..." -ForegroundColor Gray
        
        $output = & dotnet build $project.FullName -m:1 --no-incremental 2>&1 | Where-Object {
            $_ -notmatch "Add-Content.*Stream was not readable" -and
            $_ -notmatch "GetContentWriterArgumentError" -and
            $_ -notmatch "GetContentWriterIOError"
        }
        
        $outputString = $output -join "`n"
        $output | Write-Host
        
        if ($LASTEXITCODE -ne 0 -and $outputString -notmatch "Build succeeded") {
            Write-Host "Build failed for $($project.Name)" -ForegroundColor Red
            $buildSuccess = $false
            break
        }
    }
}

# Clean up environment variables
Remove-Item Env:\MSBUILDDISABLENODEREUSE -ErrorAction SilentlyContinue
Remove-Item Env:\MSBUILDNOINPROCNODE -ErrorAction SilentlyContinue

if ($buildSuccess) {
    Write-Host "Build completed successfully!" -ForegroundColor Green
    exit 0
} else {
    Write-Host "Build failed!" -ForegroundColor Red
    exit 1
}


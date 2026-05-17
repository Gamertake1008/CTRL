# CTRL Audio Setup — lädt nircmd herunter beim ersten Start
$toolsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$nircmd = Join-Path $toolsDir "nircmd.exe"

if (!(Test-Path $nircmd)) {
    Write-Host "Downloading nircmd..."
    try {
        Invoke-WebRequest -Uri "https://www.nirsoft.net/utils/nircmd.zip" -OutFile "$toolsDir\nircmd.zip"
        Expand-Archive -Path "$toolsDir\nircmd.zip" -DestinationPath $toolsDir -Force
        Remove-Item "$toolsDir\nircmd.zip" -Force
        Write-Host "nircmd installed!"
    } catch {
        Write-Host "Download failed: $_"
    }
}

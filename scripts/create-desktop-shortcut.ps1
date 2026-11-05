param(
    [string]$IconPath = (Join-Path $PSScriptRoot '..\assets\zyren-ai-tutor.ico'),
    [string]$ShortcutName = 'ZYREN AI Tutor.lnk'
)

$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$targetPath = (Resolve-Path (Join-Path $PSScriptRoot 'run.bat')).Path
$iconFullPath = [System.IO.Path]::GetFullPath($IconPath)

if (-not (Test-Path -LiteralPath $iconFullPath -PathType Leaf)) {
    throw "Icon file not found: $iconFullPath"
}

$desktopPath = [Environment]::GetFolderPath('Desktop')
if ([string]::IsNullOrWhiteSpace($desktopPath)) {
    throw 'Unable to resolve the current user Desktop folder.'
}

$shortcutPath = Join-Path $desktopPath $ShortcutName
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $targetPath
$shortcut.WorkingDirectory = $projectRoot
$shortcut.IconLocation = "$iconFullPath,0"
$shortcut.Description = 'Start ZYREN AI Tutor'
$shortcut.Save()

Write-Host "Created desktop shortcut: $shortcutPath"
Write-Host "Target: $targetPath"
Write-Host "Working directory: $projectRoot"
Write-Host "Icon: $iconFullPath"

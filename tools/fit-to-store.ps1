# Приводит картинку к ровным 1280×800 для Chrome Web Store:
#  - если больше — масштабирует вниз с сохранением пропорций (fit)
#  - если меньше — центрирует с заливкой фоном
# Аспект источника сохраняется; остаток по одной из сторон заполняется bgColor.
#
# Usage:
#   .\fit-to-store.ps1 -InputPath war1.png -OutputPath war1-store.png
#   .\fit-to-store.ps1 -InputPath war2.png -OutputPath war2-store.png '#0f172a'
#
# BgColor по умолчанию тёмно-синий (#0f172a) — под тему Warden.

param(
    [Parameter(Mandatory=$true)][string]$InputPath,
    [Parameter(Mandatory=$true)][string]$OutputPath,
    [string]$BgColor = '#0f172a'
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Drawing

$W = 1280
$H = 800

$resolvedInput = Resolve-Path $InputPath
$src = [System.Drawing.Image]::FromFile($resolvedInput.Path)
try {
    $scale = [Math]::Min($W / $src.Width, $H / $src.Height)
    $dw = [int][Math]::Round($src.Width * $scale)
    $dh = [int][Math]::Round($src.Height * $scale)
    $dx = [int](($W - $dw) / 2)
    $dy = [int](($H - $dh) / 2)

    $canvas = New-Object System.Drawing.Bitmap $W, $H
    $g = [System.Drawing.Graphics]::FromImage($canvas)
    try {
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $g.Clear([System.Drawing.ColorTranslator]::FromHtml($BgColor))
        $g.DrawImage($src, $dx, $dy, $dw, $dh)
    } finally {
        $g.Dispose()
    }
    $outFullPath = if ([System.IO.Path]::IsPathRooted($OutputPath)) { $OutputPath }
                   else { Join-Path (Get-Location).Path $OutputPath }
    $canvas.Save($outFullPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $canvas.Dispose()

    Write-Host "Saved $outFullPath ($W x $H, bg=$BgColor, src=${($src.Width)}x${($src.Height)})" -ForegroundColor Green
} finally {
    $src.Dispose()
}
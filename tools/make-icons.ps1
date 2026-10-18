# Generates the extension icons (icons/icon16.png ... icons/icon128.png).
# Usage: powershell -ExecutionPolicy Bypass -File tools/make-icons.ps1
Add-Type -AssemblyName System.Drawing

$sizes = @(16, 32, 48, 128)
$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'public\icons'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

foreach ($size in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    # Rounded square in YouTube red.
    $radius = [Math]::Max(2, [int]($size * 0.22))
    $d = $radius * 2
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc(0, 0, $d, $d, 180, 90)
    $path.AddArc($size - $d, 0, $d, $d, 270, 90)
    $path.AddArc($size - $d, $size - $d, $d, $d, 0, 90)
    $path.AddArc(0, $size - $d, $d, $d, 90, 90)
    $path.CloseFigure()

    $red = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 255, 0, 0))
    $g.FillPath($red, $path)

    # White play triangle.
    $points = @(
        (New-Object System.Drawing.PointF([float]($size * 0.40), [float]($size * 0.28))),
        (New-Object System.Drawing.PointF([float]($size * 0.40), [float]($size * 0.72))),
        (New-Object System.Drawing.PointF([float]($size * 0.74), [float]($size * 0.50)))
    )
    $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $g.FillPolygon($white, $points)

    $file = Join-Path $outDir ("icon{0}.png" -f $size)
    $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)

    $g.Dispose()
    $bmp.Dispose()
    Write-Host "wrote $file"
}

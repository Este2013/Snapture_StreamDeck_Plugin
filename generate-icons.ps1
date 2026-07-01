Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = "Stop"
$root = Join-Path $PSScriptRoot "com.este.snapture.sdPlugin\imgs"
New-Item -ItemType Directory -Force -Path $root, (Join-Path $root "actions"), (Join-Path $root "state") | Out-Null

$red = [System.Drawing.Color]::FromArgb(0xE2, 0x3B, 0x3B)

function Save-Icon([string]$name, [scriptblock]$draw) {
    foreach ($px in 72, 144) {
        $bmp = New-Object System.Drawing.Bitmap($px, $px, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $g.Clear([System.Drawing.Color]::Transparent)
        & $draw $g $px
        $g.Dispose()
        $suffix = if ($px -eq 144) { "@2x" } else { "" }
        $bmp.Save((Join-Path $root ("{0}{1}.png" -f $name, $suffix)), [System.Drawing.Imaging.ImageFormat]::Png)
        $bmp.Dispose()
    }
}

$ring = { param($g, $s)
    $pen = New-Object System.Drawing.Pen($red, [float]($s * 0.13)); $i = [float]($s * 0.2); $d = [float]($s - 2 * $i)
    $g.DrawEllipse($pen, $i, $i, $d, $d); $pen.Dispose()
}
$scan = { param($g, $s)
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, [float]($s * 0.09))
    $pen.StartCap = 'Round'; $pen.EndCap = 'Round'
    $a = [float]($s * 0.22); $b = [float]($s * 0.34); $c = [float]($s - $a); $d = [float]($s - $b)
    $g.DrawLines($pen, [System.Drawing.PointF[]]@([System.Drawing.PointF]::new($a, $b), [System.Drawing.PointF]::new($a, $a), [System.Drawing.PointF]::new($b, $a)))
    $g.DrawLines($pen, [System.Drawing.PointF[]]@([System.Drawing.PointF]::new($d, $a), [System.Drawing.PointF]::new($c, $a), [System.Drawing.PointF]::new($c, $b)))
    $g.DrawLines($pen, [System.Drawing.PointF[]]@([System.Drawing.PointF]::new($c, $d), [System.Drawing.PointF]::new($c, $c), [System.Drawing.PointF]::new($d, $c)))
    $g.DrawLines($pen, [System.Drawing.PointF[]]@([System.Drawing.PointF]::new($b, $c), [System.Drawing.PointF]::new($a, $c), [System.Drawing.PointF]::new($a, $d)))
    $pen.Dispose()
    $wb = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $r = [float]($s * 0.15); $g.FillEllipse($wb, ($s / 2 - $r), ($s / 2 - $r), 2 * $r, 2 * $r); $wb.Dispose()
}
$folder = { param($g, $s)
    $wb = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $x = [float]($s * 0.16); $y = [float]($s * 0.30); $w = [float]($s * 0.68); $h = [float]($s * 0.42)
    $tabW = [float]($s * 0.30); $tabH = [float]($s * 0.09)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $pts = [System.Drawing.PointF[]]@(
        [System.Drawing.PointF]::new($x, $y),
        [System.Drawing.PointF]::new($x + $tabW, $y),
        [System.Drawing.PointF]::new($x + $tabW + $s * 0.07, $y + $tabH),
        [System.Drawing.PointF]::new($x + $w, $y + $tabH),
        [System.Drawing.PointF]::new($x + $w, $y + $h),
        [System.Drawing.PointF]::new($x, $y + $h)
    )
    $path.AddPolygon($pts); $g.FillPath($wb, $path); $path.Dispose(); $wb.Dispose()
}
function RecFrame($g, $s, [double]$ratio) {
    $bg = New-Object System.Drawing.SolidBrush($red); $g.FillRectangle($bg, 0, 0, $s, $s); $bg.Dispose()
    $wb = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $r = [float]($s * $ratio); $g.FillEllipse($wb, ($s / 2 - $r), ($s / 2 - $r), 2 * $r, 2 * $r); $wb.Dispose()
}
$rec0 = { param($g, $s) RecFrame $g $s 0.12 }
$rec1 = { param($g, $s) RecFrame $g $s 0.18 }
$rec2 = { param($g, $s) RecFrame $g $s 0.24 }

Save-Icon "plugin"          $ring
Save-Icon "category"        $ring
Save-Icon "actions/record"  $ring
Save-Icon "actions/snapshot" $scan
Save-Icon "actions/openlast" $folder
Save-Icon "state/rec0" $rec0
Save-Icon "state/rec1" $rec1
Save-Icon "state/rec2" $rec2

Write-Output "icons written to $root"

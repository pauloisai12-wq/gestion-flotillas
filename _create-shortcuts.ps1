# Crea accesos directos en el Escritorio para start/stop
$desktop = [System.Environment]::GetFolderPath('Desktop')
$ws = New-Object -ComObject WScript.Shell

$s1 = $ws.CreateShortcut("$desktop\Flotillas v2 - Iniciar.lnk")
$s1.TargetPath = 'C:\Users\paulo\Claude Code\flotillas-v2\start.bat'
$s1.WorkingDirectory = 'C:\Users\paulo\Claude Code\flotillas-v2'
$s1.IconLocation = 'C:\Windows\System32\shell32.dll,137'
$s1.Description = 'Iniciar plataforma Flotillas v2'
$s1.Save()

$s2 = $ws.CreateShortcut("$desktop\Flotillas v2 - Detener.lnk")
$s2.TargetPath = 'C:\Users\paulo\Claude Code\flotillas-v2\stop.bat'
$s2.WorkingDirectory = 'C:\Users\paulo\Claude Code\flotillas-v2'
$s2.IconLocation = 'C:\Windows\System32\shell32.dll,131'
$s2.Description = 'Detener plataforma Flotillas v2'
$s2.Save()

Write-Host "Shortcuts creados:"
Write-Host "  - $desktop\Flotillas v2 - Iniciar.lnk"
Write-Host "  - $desktop\Flotillas v2 - Detener.lnk"

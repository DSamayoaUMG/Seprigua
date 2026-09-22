$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$bat = Join-Path $root "iniciar_vm.bat"
if (-not (Test-Path $bat)) { throw "No se encontró iniciar_vm.bat" }
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$bat`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName "SEPRIGUA" -Action $action -Trigger $trigger -Settings $settings -Description "Inicia SEPRIGUA al abrir sesión en la VM" -Force | Out-Null
Write-Host "[OK] Tarea SEPRIGUA instalada para iniciar al abrir sesión."

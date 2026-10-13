# Ejecutar una vez en PowerShell como administrador, solo si se usa acceso LAN directo.
param([ValidateRange(1,65535)][int]$Port=5000)
$ErrorActionPreference='Stop'
$RuleName="SEPRIGUA-LAN-$Port"
if (-not (Get-NetFirewallRule -Name $RuleName -ErrorAction SilentlyContinue)) {
 New-NetFirewallRule -Name $RuleName -DisplayName "SEPRIGUA LAN $Port" -Direction Inbound -Protocol TCP -LocalPort $Port -RemoteAddress LocalSubnet -Profile Domain,Private -Action Allow
}
Get-NetFirewallRule -Name $RuleName

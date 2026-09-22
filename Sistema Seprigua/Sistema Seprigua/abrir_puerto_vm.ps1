$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = Join-Path $root ".env"
if (-not (Test-Path $envFile)) { throw "Falta .env" }
$port = 5000
Get-Content $envFile | ForEach-Object {
  if ($_ -match '^\s*PORT\s*=\s*(\d+)\s*$') { $script:port = [int]$Matches[1] }
}
$ruleName = "SEPRIGUA TCP $port"
if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port | Out-Null
}
Write-Host "[OK] Puerto TCP $port habilitado para SEPRIGUA."

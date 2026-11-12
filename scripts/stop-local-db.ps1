param()
$ErrorActionPreference = 'Stop'
$serviceName = 'selection-tool-local-pg'
$service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if (-not $service) { Write-Host '本地选品开发数据库服务尚未注册。'; exit 0 }
if ($service.Status -eq 'Running') { Stop-Service -Name $serviceName -Force }
Write-Host '本地选品开发数据库已停止。'

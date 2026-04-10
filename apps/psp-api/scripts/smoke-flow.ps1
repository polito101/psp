param(
  [string]$BaseUrl = "http://localhost:3000"
)

$ErrorActionPreference = "Stop"

function Get-InternalSecret {
  $envPath = Join-Path $PSScriptRoot "..\\.env"
  if (-not (Test-Path $envPath)) {
    throw ".env no encontrado en apps/psp-api. Crea el archivo antes de correr el smoke test."
  }

  $line = Get-Content $envPath | Where-Object { $_ -match '^INTERNAL_API_SECRET=' } | Select-Object -First 1
  if (-not $line) {
    throw "No se encontró INTERNAL_API_SECRET en .env"
  }

  return ($line -replace '^INTERNAL_API_SECRET=\"?', '' -replace '\"$', '')
}

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) {
    throw $Message
  }
}

$apiBase = "$BaseUrl/api/v1"
$internalSecret = Get-InternalSecret

Write-Host "1) Health check..."
$health = Invoke-RestMethod -Method Get "$BaseUrl/health"
Assert-True ($health.status -eq "ok" -or $health.status -eq "degraded") "Health endpoint no respondió estado válido."

Write-Host "2) Crear merchant..."
$merchant = Invoke-RestMethod -Method Post "$apiBase/merchants" `
  -Headers @{ "X-Internal-Secret" = $internalSecret; "Content-Type" = "application/json" } `
  -Body (@{ name = "Smoke Merchant $(Get-Date -Format 'yyyyMMddHHmmss')" } | ConvertTo-Json -Compress)

$apiKey = $merchant.apiKey
Assert-True (-not [string]::IsNullOrWhiteSpace($apiKey)) "No se recibió apiKey al crear merchant."

Write-Host "3) Crear payment link..."
$link = Invoke-RestMethod -Method Post "$apiBase/payment-links" `
  -Headers @{ "X-API-Key" = $apiKey; "Content-Type" = "application/json" } `
  -Body (@{ amountMinor = 1999; currency = "EUR" } | ConvertTo-Json -Compress)

Assert-True (-not [string]::IsNullOrWhiteSpace($link.id)) "No se recibió paymentLinkId."

Write-Host "4) Crear pago pendiente..."
$idem = [guid]::NewGuid().ToString()
$payment = Invoke-RestMethod -Method Post "$apiBase/payments" `
  -Headers @{
    "X-API-Key" = $apiKey
    "Content-Type" = "application/json"
    "Idempotency-Key" = $idem
  } `
  -Body (@{
    amountMinor = 1999
    currency = "EUR"
    paymentLinkId = $link.id
    rail = "fiat"
  } | ConvertTo-Json -Compress)

Assert-True ($payment.status -eq "pending") "El pago no quedó en estado pending."

Write-Host "5) Capturar pago..."
$captured = Invoke-RestMethod -Method Post "$apiBase/payments/$($payment.id)/capture" `
  -Headers @{ "X-API-Key" = $apiKey; "Content-Type" = "application/json" }
Assert-True ($captured.status -eq "succeeded") "La captura no dejó el pago en estado succeeded."

Write-Host "6) Verificar estado final y balance..."
$finalPayment = Invoke-RestMethod -Method Get "$apiBase/payments/$($payment.id)" `
  -Headers @{ "X-API-Key" = $apiKey }
$balance = Invoke-RestMethod -Method Get "$apiBase/balance" `
  -Headers @{ "X-API-Key" = $apiKey }

Assert-True ($finalPayment.status -eq "succeeded") "El estado final del pago no es succeeded."
Assert-True ($balance.Count -ge 1) "No se encontraron saldos en /balance."

Write-Host ""
Write-Host "Smoke test OK"
Write-Host "merchantId: $($merchant.id)"
Write-Host "paymentLinkId: $($link.id)"
Write-Host "paymentId: $($payment.id)"
Write-Host "balanceEntries: $($balance.Count)"


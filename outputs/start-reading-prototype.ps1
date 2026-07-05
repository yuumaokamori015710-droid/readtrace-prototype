$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$envPath = Join-Path $root ".env"
$examplePath = Join-Path $root ".env.example"

if (-not (Test-Path $envPath)) {
  Copy-Item $examplePath $envPath
  Write-Host "Created .env. Put your Google Books API key in:" -ForegroundColor Yellow
  Write-Host $envPath
  Write-Host ""
}

node (Join-Path $root "reading-prototype-server.mjs")

# Stop the stack
$ErrorActionPreference = "Stop"

Write-Host "Stopping services..."
docker compose down

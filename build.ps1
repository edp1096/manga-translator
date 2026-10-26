$ErrorActionPreference = 'Stop'
Get-Command go -ErrorAction Stop | Out-Null
Get-Command npm.cmd -ErrorAction Stop | Out-Null
Push-Location (Join-Path $PSScriptRoot 'control')
$previousCgo = $env:CGO_ENABLED
try {
    $env:CGO_ENABLED = '0'
    & npm.cmd ci --prefix web
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed ($LASTEXITCODE)" }
    & go run ./cmd/package @args
    if ($LASTEXITCODE -ne 0) { throw "Release build failed ($LASTEXITCODE)" }
} finally {
    $env:CGO_ENABLED = $previousCgo
    Pop-Location
}

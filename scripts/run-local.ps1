param(
  [string]$DatabaseUrl = $env:DATABASE_URL,
  [int]$Port = 3000,
  [switch]$Fresh
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot

if (-not $DatabaseUrl) {
  throw 'Informe DATABASE_URL. Exemplo: .\scripts\run-local.ps1 -DatabaseUrl "postgres://uchiyomi:uchiyomi@localhost:5432/uchiyomi"'
}

$nodeMajor = [int]((node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 22) { throw "Node 22 ou superior é necessário. Encontrado: $(node --version)" }

function Invoke-Step([string]$Path, [string[]]$NpmArgs) {
  Push-Location $Path
  try { & npm @NpmArgs; if ($LASTEXITCODE -ne 0) { throw "Falha em npm $($NpmArgs -join ' ')" } }
  finally { Pop-Location }
}

function Ensure-Dependencies([string]$Path) {
  $modules = Join-Path $Path 'node_modules'
  if ($Fresh -or -not (Test-Path -LiteralPath $modules)) {
    Invoke-Step $Path @('ci', '--include=dev')
  } else {
    Write-Host "Dependências já presentes em $Path; reutilizando node_modules. Use -Fresh para reinstalar."
  }
}

$web = Join-Path $repo 'web'
$bff = Join-Path $repo 'bff'

Write-Host 'Instalando dependências do frontend...'
Ensure-Dependencies $web
Write-Host 'Construindo frontend...'
Invoke-Step $web @('run', 'build')
Write-Host 'Instalando dependências do backend...'
Ensure-Dependencies $bff
Write-Host 'Construindo backend...'
Invoke-Step $bff @('run', 'build')

$env:DATABASE_URL = $DatabaseUrl
$env:PORT = "$Port"
$env:WEB_ROOT = (Join-Path $web 'out')
$env:NODE_ENV = 'production'
$env:NEXT_TELEMETRY_DISABLED = '1'

Write-Host "Uchiyomi disponível em http://localhost:$Port"
Write-Host 'Pressione Ctrl+C para parar.'
Push-Location $repo
try { & node (Join-Path $bff 'dist/server.js') }
finally { Pop-Location }

param(
  [string]$DatabaseUrl = $(if ($env:DATABASE_URL) { $env:DATABASE_URL } else { 'postgres://uchiyomi:uchiyomi@localhost:5432/uchiyomi' }),
  [int]$Port = 3000,
  [switch]$Fresh,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$web = Join-Path $repo 'web'
$bff = Join-Path $repo 'bff'
$serverPath = Join-Path $bff 'dist\server.js'
$argonPath = Join-Path $bff 'node_modules\@node-rs\argon2-win32-x64-msvc\argon2.win32-x64-msvc.node'

$nodeMajor = [int]((node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 22) { throw "Node 22 ou superior e necessario. Encontrado: $(node --version)" }

function Invoke-Step([string]$Path, [string[]]$NpmArgs) {
  Push-Location $Path
  try {
    & npm @NpmArgs
    if ($LASTEXITCODE -ne 0) { throw "Falha em npm $($NpmArgs -join ' ')" }
  }
  finally { Pop-Location }
}

function Get-ListenerProcess([int]$LocalPort) {
  $listener = Get-NetTCPConnection -State Listen -LocalPort $LocalPort -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($listener) { return $listener.OwningProcess }
  return $null
}

function Test-UchiyomiBackendProcess([int]$ProcessId) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
  if (-not $process -or $process.Name -notmatch '^node(\.exe)?$') { return $false }

  # Node pode receber o caminho com barras normais ou invertidas; compare ambos
  # depois de normalizar, mas ainda exija o caminho absoluto deste repositorio.
  $commandLine = ([string]$process.CommandLine).Replace('\', '/')
  $expectedPath = $serverPath.Replace('\', '/')
  return $commandLine.Contains($expectedPath, [System.StringComparison]::OrdinalIgnoreCase)
}

function Wait-Until([scriptblock]$Condition, [string]$Description, [int]$TimeoutSeconds = 20) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (& $Condition) { return }
    Start-Sleep -Milliseconds 250
  }
  throw "Tempo esgotado aguardando $Description."
}

function Test-FileUnlocked([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return $true }
  try {
    $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    $stream.Dispose()
    return $true
  }
  catch { return $false }
}

function Get-LocalUchiyomiBackendProcesses {
  $expectedPath = $serverPath -replace '[\\/]', '/'
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $commandLine = ([string]$_.CommandLine) -replace '[\\/]', '/'
      $commandLine.Contains($expectedPath, [System.StringComparison]::OrdinalIgnoreCase)
    }
}

function Stop-LocalUchiyomiBackends {
  $backends = @(Get-LocalUchiyomiBackendProcesses)
  foreach ($backend in $backends) {
    Write-Host "Encerrando o backend Uchiyomi existente (PID $($backend.ProcessId))..."
    Stop-Process -Id $backend.ProcessId -Force
  }

  if ($backends.Count -gt 0) {
    Wait-Until { @(Get-LocalUchiyomiBackendProcesses).Count -eq 0 } 'o encerramento do backend Uchiyomi'
    Wait-Until { Test-FileUnlocked $argonPath } 'a liberacao do modulo Argon2'
  }
}

function Test-VerifiedUchiyomiBackend([int]$ProcessId, [int]$LocalPort) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
  if (-not $process -or $process.Name -notmatch '^node(\.exe)?$') { return $false }

  try {
    $response = Invoke-WebRequest "http://127.0.0.1:$LocalPort/healthz" -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -eq 200 -and $response.Content -match '"ok"\s*:\s*true'
  }
  catch { return $false }
}

function Stop-ExistingUchiyomi([int]$LocalPort) {
  Stop-LocalUchiyomiBackends

  $processId = Get-ListenerProcess $LocalPort
  if (-not $processId) { return }

  if (-not (Test-VerifiedUchiyomiBackend $processId $LocalPort)) {
    throw "A porta $LocalPort ja esta em uso pelo processo $processId, que nao e o backend Uchiyomi. Use -Port com outra porta ou encerre esse processo."
  }

  Write-Host "Encerrando o backend Uchiyomi existente (PID $processId) na porta $LocalPort..."
  Stop-Process -Id $processId -Force
  Wait-Until { -not (Get-ListenerProcess $LocalPort) } "a liberacao da porta $LocalPort"
  Wait-Until { Test-FileUnlocked $argonPath } 'a liberacao do modulo Argon2'
}

function Ensure-Dependencies([string]$Path, [string]$RequiredBinary) {
  $modules = Join-Path $Path 'node_modules'
  $binary = Join-Path $modules ".bin\$RequiredBinary.cmd"
  if ($Fresh -or -not (Test-Path -LiteralPath $modules) -or -not (Test-Path -LiteralPath $binary)) {
    Write-Host "Instalando dependencias em $Path..."
    Invoke-Step $Path @('ci', '--include=dev')
  } else {
    Write-Host "Dependencias ja presentes em $Path; reutilizando node_modules. Use -Fresh para reinstalar."
  }
}

function Wait-ForHealth([int]$LocalPort, [System.Diagnostics.Process]$Process) {
  $healthUrl = "http://127.0.0.1:$LocalPort/healthz"
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline) {
    if ($Process.HasExited) { throw "O backend encerrou durante a inicializacao (codigo $($Process.ExitCode))." }
    try {
      $response = Invoke-WebRequest $healthUrl -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -eq 200 -and $response.Content -match '"ok"\s*:\s*true') { return }
    }
    catch { }
    Start-Sleep -Milliseconds 500
  }
  throw "O backend nao respondeu com sucesso em $healthUrl."
}

function Ensure-DockerRunning {
  Write-Host 'Verificando status do Docker...'
  try {
    $null = docker info 2>&1
    if ($LASTEXITCODE -eq 0) {
      Write-Host 'Docker ja esta rodando.' -ForegroundColor Green
      return
    }
  }
  catch { }

  Write-Host 'Docker nao esta rodando. Iniciando o Docker Desktop...' -ForegroundColor Yellow
  $dockerDesktopPath = "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"

  if (Test-Path -LiteralPath $dockerDesktopPath) {
    Start-Process -FilePath $dockerDesktopPath
  }
  else {
    try {
      Start-Process 'Docker Desktop'
    }
    catch {
      Write-Host 'Nao foi possivel iniciar o Docker Desktop automaticamente. Certifique-se de que o Docker esteja instalado.' -ForegroundColor Red
      return
    }
  }

  Write-Host 'Aguardando o Docker Desktop inicializar...' -ForegroundColor Yellow
  $deadline = (Get-Date).AddSeconds(60)
  while ((Get-Date) -lt $deadline) {
    try {
      $null = docker info 2>&1
      if ($LASTEXITCODE -eq 0) {
        Write-Host 'Docker iniciado com sucesso!' -ForegroundColor Green
        return
      }
    }
    catch { }
    Start-Sleep -Seconds 2
  }
  Write-Host 'Aviso: Tempo esgotado aguardando a inicializacao do Docker. Prosseguindo...' -ForegroundColor Yellow
}

# O ambiente precisa estar pronto antes do build do Next.js e permanecer igual no backend.
$env:DATABASE_URL = $DatabaseUrl
$env:PORT = "$Port"
$env:WEB_ROOT = (Join-Path $web 'out')
$env:NODE_ENV = 'production'
$env:NEXT_TELEMETRY_DISABLED = '1'

Ensure-DockerRunning

Stop-ExistingUchiyomi $Port

Write-Host 'Preparando frontend...'
Ensure-Dependencies $web 'next'
Write-Host 'Construindo frontend...'
Invoke-Step $web @('run', 'build')
Write-Host 'Preparando backend...'
Ensure-Dependencies $bff 'tsc'
Write-Host 'Construindo backend...'
Invoke-Step $bff @('run', 'build')

Write-Host "Iniciando backend com DATABASE_URL = $DatabaseUrl ..."
$process = Start-Process -FilePath 'node' -ArgumentList "`"$serverPath`"" -WorkingDirectory $repo -NoNewWindow -PassThru
try {
  Wait-ForHealth $Port $process

  $localUrl = "http://localhost:$Port"
  $networkIps = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.InterfaceAlias -notmatch 'Loopback|vEthernet|Virtual|WSL|Bluetooth' -and $_.IPAddress -notmatch '^169\.254|^127\.' } |
    Select-Object -ExpandProperty IPAddress -Unique)

  $primaryNetworkUrl = if ($networkIps.Count -gt 0) { "http://$($networkIps[0]):$Port" } else { $localUrl }

  Write-Host ""
  Write-Host "==========================================================" -ForegroundColor Green
  Write-Host " Uchiyomi disponivel com sucesso!" -ForegroundColor Green
  Write-Host " Local:        $localUrl" -ForegroundColor Cyan
  foreach ($ip in $networkIps) {
    Write-Host " Rede Local:   http://${ip}:$Port" -ForegroundColor Yellow
  }
  Write-Host "==========================================================" -ForegroundColor Green
  Write-Host ""

  $qrPageUrl = "$localUrl/qr"

  $qrcodePath = Join-Path $bff 'node_modules\qrcode'
  if (Test-Path -LiteralPath $qrcodePath) {
    Write-Host "QR Code para acesso na sua rede local ($primaryNetworkUrl):" -ForegroundColor Magenta
    node -e "const q=require('./bff/node_modules/qrcode'); q.toString('$primaryNetworkUrl', {type:'terminal', small:true}, (e,s)=>console.log(s))"
    Write-Host ""
  }

  if (-not $NoBrowser) {
    Write-Host "Abrindo pagina web com o QR Code no navegador ($qrPageUrl)..."
    Start-Process $qrPageUrl
  }

  Write-Host 'Pressione Ctrl+C para parar.'
  Wait-Process -Id $process.Id
}
finally {
  if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }
}

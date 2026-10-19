$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $projectRoot

if (Get-Process -Name 'opencode' -ErrorAction SilentlyContinue) {
  throw 'Ya existe un proceso OpenCode. Revisa su tarea antes de iniciar otra sesión.'
}
if (-not (Get-Command 'opencode' -ErrorAction SilentlyContinue)) {
  throw 'OpenCode CLI no está disponible en esta terminal.'
}
if (-not (Test-Path -LiteralPath 'AGENTS.md') -or -not (Test-Path -LiteralPath 'COORDINATION.md')) {
  throw 'Faltan los archivos de coordinación. No se inicia OpenCode.'
}

$task = @'
Lee AGENTS.md, COORDINATION.md, git status --short y los archivos reservados antes de editar. Tu tarea exclusiva es revisar EcoGuía remota en artifacts/api-server/src/lib/aiGuide.ts y aiGuideCore.ts, con aiGuide.test.mjs o pruebas nuevas exclusivas. Conserva todas las funciones, pruebas y archivos existentes; NO borres ni reemplaces avances. Corrige solo un problema comprobable y añade pruebas con fetch falso, sin llamadas reales a OpenRouter ni datos de ecopulse_dev. No edites aiProvider.ts, aiClassification*, App.tsx, pilot.ts, interactive-map.tsx, vite.config.ts, esquemas, migraciones, permisos, configuración, .env.local ni archivos de Codex. Si requiere un archivo común, anota la dependencia en COORDINATION.md sin editarlo. Ejecuta test:guide y typecheck de API; escribe archivos, resultados y riesgos en COORDINATION.md y termina. No agentes hijos, no push ni despliegue.
'@

Write-Host 'Iniciando OpenCode en esta terminal integrada; tarea exclusiva de EcoGuía.'
& opencode run --standalone --auto --title 'EcoPulse EcoGuía coordinada' $task
if ($LASTEXITCODE -ne 0) { throw "OpenCode terminó con código $LASTEXITCODE. Revisa su salida y COORDINATION.md." }

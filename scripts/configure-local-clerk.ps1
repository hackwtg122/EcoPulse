param([switch]$CheckOnly)

$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$localEnvFile = Join-Path $repositoryRoot '.env.local'

Push-Location $repositoryRoot
try {
  & git check-ignore --quiet -- '.env.local'
  if ($LASTEXITCODE -ne 0) {
    throw '.env.local is not ignored by Git; refusing to write Clerk credentials.'
  }
  $trackedPaths = @(& git ls-files --cached -- '.env.local')
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not verify whether .env.local is tracked by Git.'
  }
  if ($trackedPaths.Count -gt 0) {
    throw '.env.local is tracked by Git; refusing to write Clerk credentials.'
  }
} finally {
  Pop-Location
}

if ($CheckOnly) {
  Write-Output '.env.local is ignored and is not tracked by Git. Clerk credentials were not requested or changed.'
  return
}

if (-not (Test-Path -LiteralPath $localEnvFile)) {
  [System.IO.File]::WriteAllText($localEnvFile, '', [System.Text.UTF8Encoding]::new($false))
}

function Read-HiddenValue([string]$Prompt) {
  $secureValue = Read-Host $Prompt -AsSecureString
  $valuePointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($valuePointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($valuePointer)
  }
}

function Set-EnvValue([System.Collections.Generic.List[string]]$Lines, [string]$Name, [string]$Value) {
  $prefix = "$Name="
  $replacement = "$prefix$Value"
  $found = $false
  for ($index = 0; $index -lt $Lines.Count; $index++) {
    if ($Lines[$index].StartsWith($prefix, [StringComparison]::Ordinal)) {
      if (-not $found) {
        $Lines[$index] = $replacement
        $found = $true
      } else {
        $Lines.RemoveAt($index)
        $index--
      }
    }
  }
  if (-not $found) { $Lines.Add($replacement) }
}

$publishableKey = Read-HiddenValue 'Introduce la Publishable Key de Development (pk_test_, oculta)'
$secretKey = Read-HiddenValue 'Introduce la Secret Key de Development (sk_test_, oculta)'

try {
  if ($publishableKey -notmatch '^pk_test_[A-Za-z0-9_-]+$') {
    throw 'La clave publicable no tiene un formato pk_test_ válido. No se modificó .env.local.'
  }
  if ($secretKey -notmatch '^sk_test_[A-Za-z0-9_-]+$') {
    throw 'La clave secreta no tiene un formato sk_test_ válido. No se modificó .env.local.'
  }

  $lines = [System.Collections.Generic.List[string]]::new()
  foreach ($line in [System.IO.File]::ReadAllLines($localEnvFile)) { $lines.Add($line) }

  Set-EnvValue $lines 'VITE_CLERK_PUBLISHABLE_KEY' $publishableKey
  Set-EnvValue $lines 'CLERK_PUBLISHABLE_KEY' $publishableKey
  Set-EnvValue $lines 'CLERK_SECRET_KEY' $secretKey
  Set-EnvValue $lines 'PILOT_ALLOWED_ORIGINS' 'http://127.0.0.1:5173'
  Set-EnvValue $lines 'VITE_CLERK_PROXY_URL' ''

  [System.IO.File]::WriteAllLines($localEnvFile, $lines, [System.Text.UTF8Encoding]::new($false))
  Write-Output 'Clerk Development configuration saved in ignored .env.local. No key values were printed.'
} finally {
  Remove-Variable publishableKey, secretKey -ErrorAction SilentlyContinue
}

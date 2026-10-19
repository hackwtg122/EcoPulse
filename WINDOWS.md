# EcoPulse en Windows (etapa 2)

El proyecto usa Node.js 22, pnpm 11.25.0 fijado en `package.json` y PowerShell. No se necesita instalar Git Bash para ejecutar los scripts del proyecto.

## pnpm con Corepack

Corepack viene con la instalación actual de Node.js. Para crear el comando `pnpm` en el perfil del usuario, sin modificar `C:\Program Files\nodejs`, ejecute una vez:

```powershell
corepack enable pnpm --install-directory "$env:APPDATA\npm"
pnpm --version
```

La carpeta `%APPDATA%\npm` debe figurar en el `Path` del usuario. Abra una terminal nueva de VS Code después de habilitar el comando. Corepack descargará la versión fijada por el proyecto la primera vez que se use.

## Instalar y comprobar

Desde la raíz del repositorio:

```powershell
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run build
pnpm --filter @workspace/api-server run test:policy
pnpm --filter @workspace/eco-pulse run test:demo
```

El lockfile mantiene `minimumReleaseAge: 1440`. El workspace usa `nodeLinker: hoisted` porque el enlazador aislado falló con `EPERM` al enlazar dependencias de Clerk en este Windows. La instalación requiere acceso a `https://registry.npmjs.org/`. Si aparece `ECONNREFUSED`, revise los valores de proxy y modo sin conexión **en esa terminal** antes de cambiar una configuración persistente. En una sesión previa de Codex, esas variables pertenecían solo al proceso de ejecución; la conexión HTTPS directa del equipo sí respondió.

## Desarrollo local

Use dos terminales de PowerShell:

```powershell
# Terminal 1: API en http://127.0.0.1:5000
pnpm --filter @workspace/api-server run dev
```

```powershell
# Terminal 2: Vite en http://127.0.0.1:5173
pnpm --filter @workspace/eco-pulse run dev
```

`PORT` puede establecerse por separado en cada terminal si necesita otros puertos; `BASE_PATH` del frontend usa `/` por defecto. En desarrollo, los servidores escuchan solo en `127.0.0.1`; configure `HOST` explícitamente si necesita acceso desde otro dispositivo. En Replit se conserva la escucha en todas las interfaces. Sin PostgreSQL y claves de desarrollo de Clerk, la API `/api/pilot` responde `503 pilot_api_unconfigured`. La interfaz conserva su modo demostración explícito. La configuración de PostgreSQL y Clerk corresponde a la etapa 3; ninguna migración se aplica mediante estos comandos.

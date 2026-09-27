# Run a Blender Python script headless: run.ps1 <script.py> [args passed after --]
param(
  [Parameter(Mandatory = $true)][string]$Script,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest
)
$blender = 'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe'
& $blender --background --factory-startup --python-exit-code 1 --python $Script -- @Rest
exit $LASTEXITCODE

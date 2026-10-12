# Compile scripts/bootstrap-windows.ps1 into dist/Black.Forest.Tools-Setup.exe
# Uses built-in csc / Add-Type — no NuGet / ps2exe.
$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$BootstrapPath = Join-Path $Root "scripts\bootstrap-windows.ps1"
$OutDir = Join-Path $Root "dist"
$OutExe = Join-Path $OutDir "Black.Forest.Tools-Setup.exe"
$Version = "1.0.0.0"
if (Test-Path (Join-Path $Root "package.json")) {
  $pkg = Get-Content (Join-Path $Root "package.json") -Raw | ConvertFrom-Json
  if ($pkg.version -match '^(\d+)\.(\d+)\.(\d+)') {
    $Version = "$($Matches[1]).$($Matches[2]).$($Matches[3]).0"
  }
}

if (-not (Test-Path $BootstrapPath)) {
  throw "Missing $BootstrapPath"
}
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$scriptText = Get-Content -Raw -Path $BootstrapPath
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($scriptText))

$cs = @"
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;

[assembly: AssemblyTitle("Black Forest Tools Setup")]
[assembly: AssemblyProduct("Black Forest Tools Setup")]
[assembly: AssemblyCompany("Black Forest Automotive")]
[assembly: AssemblyVersion("$Version")]
[assembly: AssemblyFileVersion("$Version")]

internal static class Program {
  private const string BootstrapB64 = "$b64";

  private static int Main() {
    Console.WriteLine("Black Forest Tools Setup");
    string tempPs1 = Path.Combine(Path.GetTempPath(), "BlackForestTools-Setup-" + Guid.NewGuid().ToString("n") + ".ps1");
    try {
      File.WriteAllText(tempPs1, Encoding.UTF8.GetString(Convert.FromBase64String(BootstrapB64)), new UTF8Encoding(false));
      var psi = new ProcessStartInfo {
        FileName = "powershell.exe",
        Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + tempPs1 + "\"",
        UseShellExecute = false,
      };
      using (var p = Process.Start(psi)) {
        if (p == null) {
          Console.Error.WriteLine("Could not start PowerShell.");
          return 1;
        }
        p.WaitForExit();
        return p.ExitCode;
      }
    } catch (Exception ex) {
      Console.Error.WriteLine(ex.Message);
      return 1;
    } finally {
      try { if (File.Exists(tempPs1)) File.Delete(tempPs1); } catch { }
    }
  }
}
"@

$csPath = Join-Path $OutDir "BlackForestTools-Setup.cs"
Set-Content -Path $csPath -Value $cs -Encoding UTF8

# Prefer csc.exe when present; fall back to Add-Type.
$csc = Get-ChildItem "$env:WINDIR\Microsoft.NET\Framework64\v4*\csc.exe" -ErrorAction SilentlyContinue |
  Sort-Object FullName -Descending | Select-Object -First 1
if ($csc) {
  & $csc.FullName /nologo /target:exe /out:$OutExe $csPath
  if ($LASTEXITCODE -ne 0) { throw "csc failed" }
} else {
  Add-Type -TypeDefinition (Get-Content -Raw $csPath) -OutputAssembly $OutExe -OutputType ConsoleApplication
}
if (-not (Test-Path $OutExe)) {
  throw "Failed to compile $OutExe"
}
Write-Host "Compiled git Setup: $OutExe ($((Get-Item $OutExe).Length) bytes)"

[CmdletBinding()]
param(
    [ValidateSet('Small', 'Medium', 'Large')]
    [string]$Tier = 'Small',
    [ValidateRange(1, 100)]
    [int]$Samples = 10,
    [string]$OutputPath
)

$profiles = @{
    Small = @{ Commits = 100; Files = 100 }
    Medium = @{ Commits = 2000; Files = 5000 }
    Large = @{ Commits = 10000; Files = 20000 }
}
$profile = $profiles[$Tier]
$root = Join-Path ([System.IO.Path]::GetTempPath()) ("rustgit-status-benchmark-" + [guid]::NewGuid())
$repo = Join-Path $root 'repo'

function Invoke-Git {
    param([string[]]$Arguments)
    & git -C $repo -c core.excludesFile= @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "git failed: $($Arguments -join ' ')"
    }
}

try {
    New-Item -ItemType Directory -Path $repo -Force | Out-Null
    Invoke-Git @('init', '--initial-branch=main')
    Invoke-Git @('config', 'user.name', 'RustGit Benchmark')
    Invoke-Git @('config', 'user.email', 'benchmark@rustgit.invalid')
    Invoke-Git @('config', 'commit.gpgsign', 'false')
    Invoke-Git @('config', 'core.autocrlf', 'false')

    for ($index = 0; $index -lt $profile.Files; $index++) {
        $file = Join-Path $repo ("files/file-{0:D6}.txt" -f $index)
        New-Item -ItemType Directory -Path (Split-Path $file) -Force | Out-Null
        [System.IO.File]::WriteAllText($file, "seed $index`n")
    }
    Invoke-Git @('add', '--all')
    Invoke-Git @('commit', '--quiet', '-m', 'seed')

    for ($commit = 1; $commit -lt $profile.Commits; $commit++) {
        $fileIndex = $commit % $profile.Files
        $relative = "files/file-{0:D6}.txt" -f $fileIndex
        [System.IO.File]::AppendAllText((Join-Path $repo $relative), "commit $commit`n")
        Invoke-Git @('add', '--', $relative)
        Invoke-Git @('commit', '--quiet', '-m', "commit $commit")
    }

    [System.IO.File]::AppendAllText((Join-Path $repo 'files/file-000000.txt'), "working tree change`n")
    $measurements = for ($sample = 1; $sample -le $Samples; $sample++) {
        $watch = [System.Diagnostics.Stopwatch]::StartNew()
        & git -C $repo -c core.excludesFile= status '--porcelain=v2' '--branch' '-z' '--untracked-files=all' | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'git status failed' }
        $watch.Stop()
        [math]::Round($watch.Elapsed.TotalMilliseconds, 3)
    }

    $sorted = @($measurements | Sort-Object)
    $result = [ordered]@{
        timestampUtc = [DateTime]::UtcNow.ToString('o')
        tier = $Tier
        commits = $profile.Commits
        files = $profile.Files
        samplesMilliseconds = $measurements
        averageMilliseconds = [math]::Round((($measurements | Measure-Object -Average).Average), 3)
        p50Milliseconds = $sorted[[math]::Ceiling($sorted.Count * 0.50) - 1]
        p95Milliseconds = $sorted[[math]::Ceiling($sorted.Count * 0.95) - 1]
        gitVersion = (& git --version).Trim()
        os = [System.Environment]::OSVersion.VersionString
    }
    $json = $result | ConvertTo-Json -Depth 3
    if ($OutputPath) {
        $parent = Split-Path -Parent $OutputPath
        if ($parent) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
        Set-Content -LiteralPath $OutputPath -Value $json -Encoding utf8
    }
    $json
}
finally {
    if (Test-Path -LiteralPath $root) {
        Remove-Item -LiteralPath $root -Recurse -Force
    }
}
